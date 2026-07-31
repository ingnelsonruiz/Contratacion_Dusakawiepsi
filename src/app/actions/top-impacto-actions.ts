"use server";

/**
 * Server Actions del módulo "Análisis de Códigos de Mayor Impacto Económico"
 * (2026-07-29) — ver comentario completo en `src/types/top-impacto.ts`.
 *
 * Diseño de las 3 consultas principales (`obtenerPorCodigo`,
 * `obtenerPorPrestador`, `obtenerPorMunicipio`): en vez de repetir una
 * consulta por cada uno de los 3 tipos de tarifario (que multiplicaría el
 * número de viajes a la BD hasta 9), cada consulta arma UN solo SQL con
 * `UNION ALL` de las tablas RIPS necesarias (1 a 3 según el filtro "Tipo"),
 * y agrega por código/prestador/municipio en una sola pasada. El fragmento
 * `ARRAY(SELECT consecutivo_rips FROM rips_af WHERE ...)` (filtro de
 * año+prestador+municipio+contrato) se repite textualmente en cada rama del
 * UNION porque cada tabla RIPS grande necesita su propia resolución de
 * `consecutivo_rips = ANY(...)` (índice real en las 3, ver nota crítica en
 * `movimiento-rips-actions.ts` sobre por qué NUNCA usar `IN (subquery)`).
 */

import { pool } from "@/lib/db";
import { CONTRATOS_EXCLUIDOS_MIGRACION } from "@/lib/negociacion/constantes";
import { construirFilaTopImpacto, calcularKpisTopImpacto, type FilaCrudaTopImpacto } from "@/lib/negociacion/top-impacto";
import { sqlFacturasCanonicas, joinFacturaCanonica } from "@/lib/negociacion/rips-dedup";
import type {
  TipoImpacto,
  FiltrosImpacto,
  OpcionesFiltrosImpacto,
  OpcionContratoPrestador,
  ResultadoTopImpacto,
  FilaImpactoPrestador,
  FilaImpactoMunicipio,
  FilaFacturaImpacto,
  ResultadoFacturasImpacto,
} from "@/types/top-impacto";

const SOURCE = "top-impacto";

/** Primer año con volumen real de datos en `rips_af` — verificado 2026-07-29 (2021 y años anteriores tienen <30K registros combinados, ruido de migración). */
const PRIMER_ANIO_CON_DATOS = 2022;

type TipoEspecifico = Exclude<TipoImpacto, "todos">;

const TABLA_TIPO: Record<
  TipoEspecifico,
  {
    tabla: string;
    alias: string;
    columnaCodigo: string;
    columnaValor: string;
    catalogo: string;
    columnaCatalogoDescripcion: string;
    /**
     * Catálogo de respaldo cuando el código no resuelve en `catalogo` —
     * agregado 2026-07-30 tras verificar un hallazgo real: códigos de
     * "estancia"/habitación (ej. `108A01` "INTERNACIÓN EN UNIDAD DE CUIDADO
     * INTENSIVO NEONATAL") son códigos CUPS reales (existen en `tb_cup`), pero
     * ARYUWIS los reporta vía el archivo RIPS de "otros servicios" (`rips_at`,
     * tipo "insumos" de este módulo) en vez del archivo de procedimientos
     * (`rips_ap`). Verificado a escala EPS-completa (año 2026): de 8.288
     * códigos distintos en `rips_at`, solo 1.091 (13%) resuelven en
     * `tb_insumo`, pero 354 (4,3%) resuelven ÚNICAMENTE en `tb_cup` — y en
     * valor, esos 354 códigos representan **$49.329.517.821 de $67.523.703.878
     * (73%)** del total facturado bajo "insumos", muy por encima del 9% que sí
     * es insumo real (`tb_insumo`). Sin este respaldo, la tabla mostraba el
     * código repetido como descripción (`"108A01 — 108A01"`) para exactamente
     * estos casos de alto valor.
     */
    catalogoFallback?: string;
    aliasFallback?: string;
  }
> = {
  servicios: {
    tabla: "rips_ap",
    alias: "ap",
    columnaCodigo: "codigo_procedimiento",
    columnaValor: "valor_procedimiento",
    catalogo: "tb_cup",
    columnaCatalogoDescripcion: "descripcion",
  },
  // Agregado 2026-07-29 tras verificar contra un caso real (contrato
  // EV-20001-2026-1): faltaba por completo — el "Valor Real Radicado" de una
  // factura es AP+AC+AM+AT, nunca solo AP+AM+AT. Comparte catálogo `tb_cup`
  // con "servicios" (verificado: `codigo_consulta` sí resuelve descripción
  // ahí, ej. "890602 → CUIDADO (MANEJO) INTRAHOSPITALARIO POR MEDICINA
  // ESPECIALIZADA"), pero es una tabla RIPS distinta — se mantiene como tipo
  // separado.
  consultas: {
    tabla: "rips_ac",
    alias: "ac",
    columnaCodigo: "codigo_consulta",
    columnaValor: "valor_consulta",
    catalogo: "tb_cup",
    columnaCatalogoDescripcion: "descripcion",
  },
  medicamentos: {
    tabla: "rips_am",
    alias: "am",
    columnaCodigo: "codigo_medicamento",
    columnaValor: "valor_total_medicamento",
    catalogo: "tb_medicamento",
    columnaCatalogoDescripcion: "descripcion",
  },
  // El código real del insumo viene en `codigo_servicio`, NUNCA en
  // `codigo_tarifario` (siempre NULL) — mismo hallazgo ya documentado en
  // Módulo 4 y en "Movimientos RIPS". Corrección 2026-07-30: se agrega
  // `catalogoFallback: tb_cup` — ver comentario completo en el tipo de arriba.
  insumos: {
    tabla: "rips_at",
    alias: "at2",
    columnaCodigo: "codigo_servicio",
    columnaValor: "valor_total_material",
    catalogo: "tb_insumo",
    columnaCatalogoDescripcion: "descripcion",
    catalogoFallback: "tb_cup",
    aliasFallback: "cupFallback",
  },
};

function tiposSeleccionados(tipo: TipoImpacto): TipoEspecifico[] {
  return tipo === "todos" ? ["servicios", "consultas", "medicamentos", "insumos"] : [tipo];
}

interface FragmentoFacturas {
  /** `WITH facturas_periodo AS MATERIALIZED (...)` — se antepone UNA vez a cada consulta. */
  cte: string;
  /** Referencia corta a la CTE ya materializada — reemplaza el `ARRAY(SELECT ... FROM rips_af ...)` repetido. */
  ref: string;
  params: unknown[];
}

/**
 * CTE reutilizada en las 3 consultas — `WITH facturas_periodo AS MATERIALIZED
 * (SELECT consecutivo_rips FROM rips_af WHERE ...)`, nunca materializada en
 * Node (vive solo dentro de la sesión de Postgres de esa consulta puntual).
 * Acumula dinámicamente las condiciones de año (obligatoria) + prestador/
 * municipio/contrato (opcionales, combinables).
 *
 * CORRECCIÓN 2026-07-29 (mismo día del lanzamiento): la primera versión
 * repetía el `ARRAY(SELECT consecutivo_rips FROM rips_af WHERE ...)` como
 * texto crudo en CADA rama del `UNION ALL` — con `tipo=todos` eso significaba
 * escanear `rips_af` completa (Seq Scan, ~1.8-2s) hasta 3 veces por cada una
 * de las 3 consultas principales (por-código/por-prestador/por-municipio),
 * es decir hasta 9 veces por request. Envolver el mismo fragmento en `WITH
 * ... AS MATERIALIZED (...)` fuerza a Postgres a resolverlo UNA sola vez por
 * consulta (verificado con `EXPLAIN ANALYZE`: el "CTE Scan" reutiliza el
 * resultado ya materializado en <15ms en las ramas siguientes) y cada rama
 * del UNION solo hace `ARRAY(SELECT consecutivo_rips FROM facturas_periodo)`
 * sobre esa CTE ya resuelta.
 *
 * CORRECCIÓN CRÍTICA 2026-07-29 (mismo día, tras reporte de usuario:
 * "después de un rato me arroja información poco real, me parecía más real
 * la primera"): la versión de la mejora #80 seleccionaba
 * `SELECT consecutivo_rips, codigo_prestador FROM rips_af WHERE ...` SIN
 * deduplicar. Se verificó que `rips_af.consecutivo_rips` **no es único** —
 * a diferencia de lo asumido en todo el resto del proyecto, esta columna se
 * comporta como un identificador de LOTE/RADICACIÓN compartido por muchas
 * facturas del mismo prestador el mismo día, no como un ID de factura. Caso
 * real verificado: `consecutivo_rips = 720812` aparece en 951 filas de
 * `rips_af` (951 `numero_factura`/`consecutivo_rips_af` distintos, mismo
 * `codigo_prestador`). Al unir `construirJoinFactura` (`JOIN facturas_periodo
 * fp ON fp.consecutivo_rips = <alias>.consecutivo_rips`) contra esa CTE sin
 * deduplicar, cada línea de detalle se multiplicaba por la cantidad de
 * facturas que comparten ese mismo `consecutivo_rips` (hasta 951x) — inflando
 * los valores a niveles absurdos (ej. código S50008: valor real
 * $11.260.116.450, valor mostrado $7.48 billones, un código representando
 * "solo" el 85% del gasto total de la EPS, imposible).
 *
 * FIX: `DISTINCT ON (consecutivo_rips)` en la CTE — garantiza EXACTAMENTE una
 * fila por `consecutivo_rips`, eliminando el fanout del `JOIN` sin perder la
 * mejora de atribución por `codigo_prestador` de la factura. Se verificó que
 * `codigo_prestador` es consistente entre las filas que comparten un mismo
 * `consecutivo_rips` en el 99.9%+ de los casos (0 conflictos en los grupos de
 * mayor duplicidad para 2026 completo); existen 717 grupos EPS-completa
 * (todos los años) donde SÍ hay más de un `codigo_prestador` distinto para el
 * mismo `consecutivo_rips` (dato de origen inconsistente, no un bug de esta
 * consulta) — `DISTINCT ON` resuelve esos casos eligiendo uno de forma
 * determinística en vez de fallar o multiplicar filas, que es la opción
 * segura para una herramienta financiera. Verificado con `EXPLAIN ANALYZE`
 * que el costo adicional del `Unique`/`Sort` dentro de la CTE materializada
 * es aceptable (~2.3s para año completo, pagado una sola vez por consulta).
 */
function construirFragmentoFacturas(filtros: FiltrosImpacto, codigoPrestador: string | null): FragmentoFacturas {
  const inicio = `${filtros.anio}-01-01`;
  const fin = `${filtros.anio + 1}-01-01`;
  const params: unknown[] = [inicio, fin];
  let condiciones = "fecha_anula IS NULL AND fecha_servicio_rips >= $1 AND fecha_servicio_rips < $2";

  if (codigoPrestador) {
    params.push(codigoPrestador);
    condiciones += ` AND codigo_prestador = $${params.length}`;
  }
  if (filtros.municipioCodigo) {
    params.push(filtros.municipioCodigo);
    condiciones += ` AND codigo_prestador = ANY(ARRAY(SELECT codigo_prestador FROM administrativo.ct_ips WHERE municipio = $${params.length} AND codigo_prestador IS NOT NULL))`;
  }
  if (filtros.numerosContrato && filtros.numerosContrato.length > 0) {
    params.push(filtros.numerosContrato);
    condiciones += ` AND codigo_prestador = ANY(ARRAY(SELECT ci.codigo_prestador FROM administrativo.ct_ips_contrato c JOIN administrativo.ct_ips ci ON ci.ips = c.ips WHERE c.numero_contrato = ANY($${params.length}) AND ci.codigo_prestador IS NOT NULL))`;
  }

  return {
    // CORRECCIÓN 2026-07-29: la CTE trae `codigo_prestador` de `rips_af` (el
    // prestador "de la factura", no el de la línea de detalle — ver nota
    // extensa en `construirUnionCrudo`), con `DISTINCT ON (consecutivo_rips)`
    // para garantizar una sola fila por `consecutivo_rips` — ver nota crítica
    // arriba sobre por qué esto es obligatorio (fanout en el JOIN).
    //
    // CORRECCIÓN CRÍTICA 2026-07-30 (reportada por el usuario contra un caso
    // real, factura MV06370): se agrega la CTE `facturas_canonicas`, que
    // deduplica una SEGUNDA vez, ahora por factura real (`codigo_prestador` +
    // `numero_factura`) en vez de por lote (`consecutivo_rips`) — una misma
    // factura puede aparecer repetida en varios lotes distintos (recargas de
    // RIPS no limpiadas), lo que multiplicaba su valor real hasta 13x en
    // casos verificados. Ver comentario completo y magnitud EPS-completa en
    // `src/lib/negociacion/rips-dedup.ts` y KnowledgeBase/04-BaseDatos/Tablas.md.
    cte: `WITH facturas_periodo AS MATERIALIZED (SELECT DISTINCT ON (consecutivo_rips) consecutivo_rips, codigo_prestador FROM administrativo.rips_af WHERE ${condiciones} ORDER BY consecutivo_rips), facturas_canonicas AS MATERIALIZED (${sqlFacturasCanonicas(condiciones)})`,
    ref: "ARRAY(SELECT consecutivo_rips FROM facturas_periodo)",
    params,
  };
}

/**
 * `JOIN facturas_periodo fp ON fp.consecutivo_rips = <alias>.consecutivo_rips`
 * — se antepone a cada rama para poder usar `fp.codigo_prestador` (el
 * prestador confiable, de la FACTURA) en vez de `<alias>.codigo_prestador`
 * (el de la línea de detalle, que puede ser una sede específica no
 * registrada en `ct_ips` — ver hallazgo completo en `construirUnionCrudo`).
 * Se mantiene el filtro `WHERE consecutivo_rips = ANY(${fragmento.ref})`
 * ADEMÁS del JOIN (no en su lugar) — verificado con `EXPLAIN ANALYZE` que
 * quitarlo hace que el planificador de Postgres pierda el `Index Scan` sobre
 * `rips_ap_idx_rips` y en su lugar escanee la tabla COMPLETA (177M filas,
 * ~50s) para poder hacer el `Merge Join` con la CTE; con el `WHERE` presente,
 * el `Index Scan` ya reduce el conjunto ANTES del join contra la CTE
 * (~4-7s, join barato porque la CTE ya está materializada y es chica).
 */
function construirJoinFactura(alias: string): string {
  // El 2do JOIN (`facturas_canonicas`) es el fix del 2026-07-30 — sin él, una
  // factura recargada en varios lotes cuenta sus líneas de detalle una vez
  // POR LOTE en vez de una sola vez. Ver `rips-dedup.ts`.
  return `JOIN facturas_periodo fp ON fp.consecutivo_rips = ${alias}.consecutivo_rips ${joinFacturaCanonica(alias)}`;
}

async function obtenerPorCodigo(tipos: TipoEspecifico[], fragmento: FragmentoFacturas): Promise<FilaCrudaTopImpacto[]> {
  const ramas = tipos.map((t) => {
    const info = TABLA_TIPO[t];
    // `catalogoFallback` (hoy solo "insumos" → tb_cup): si el código no
    // resuelve en el catálogo principal, se intenta el de respaldo antes de
    // caer en NULL — ver comentario completo en TABLA_TIPO.
    const joinFallback = info.catalogoFallback
      ? `LEFT JOIN administrativo.${info.catalogoFallback} ${info.aliasFallback} ON ${info.aliasFallback}.codigo_interno = ${info.alias}.${info.columnaCodigo}`
      : "";
    const columnaDescripcion = info.catalogoFallback
      ? `COALESCE(cat.${info.columnaCatalogoDescripcion}, ${info.aliasFallback}.descripcion)`
      : `cat.${info.columnaCatalogoDescripcion}`;
    const groupByDescripcion = info.catalogoFallback
      ? `cat.${info.columnaCatalogoDescripcion}, ${info.aliasFallback}.descripcion`
      : `cat.${info.columnaCatalogoDescripcion}`;
    return `
      SELECT '${t}'::text AS tipo, ${info.alias}.${info.columnaCodigo} AS codigo, ${columnaDescripcion} AS descripcion,
        COUNT(*) AS cantidad, SUM(${info.alias}.${info.columnaValor}) AS valor, COUNT(DISTINCT fp.codigo_prestador) AS prestadores
      FROM administrativo.${info.tabla} ${info.alias}
      ${construirJoinFactura(info.alias)}
      LEFT JOIN administrativo.${info.catalogo} cat ON cat.codigo_interno = ${info.alias}.${info.columnaCodigo}
      ${joinFallback}
      WHERE ${info.alias}.consecutivo_rips = ANY(${fragmento.ref})
      GROUP BY ${info.alias}.${info.columnaCodigo}, ${groupByDescripcion}
    `;
  });
  const sql = `${fragmento.cte} ${ramas.join(" UNION ALL ")} ORDER BY valor DESC`;
  const result = await pool.query(sql, fragmento.params, `${SOURCE}/por-codigo`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    tipo: r.tipo,
    codigo: r.codigo,
    descripcion: r.descripcion,
    cantidad: Number(r.cantidad ?? 0),
    valor: Number(r.valor ?? 0),
    prestadores: Number(r.prestadores ?? 0),
  }));
}

/**
 * Base del UNION crudo (codigo_prestador, valor) reutilizada por prestador y
 * por municipio — sin agrupar todavía.
 *
 * CORRECCIÓN 2026-07-29 (mismo día, tras verificar contra un caso real —
 * contrato EV-20001-2026-1 / CLINICA MEDICOS S.A.): la primera versión usaba
 * `<alias>.codigo_prestador` (el código de la LÍNEA de detalle) para
 * atribuir el valor a un prestador. Verificado que ese código puede variar
 * por SEDE dentro de la misma factura/institución — para este contrato,
 * las líneas de detalle usan 3 códigos distintos ("200010053001",
 * "200010053003", "200010053005") aunque LA FACTURA (`rips_af`) siempre
 * tiene el mismo `codigo_prestador` = "200010053001" (verificado: 920/920
 * facturas del contrato, 100%). Verificado también a nivel EPS-completa:
 * de 329 `codigo_prestador` distintos en `rips_af` (año 2026), solo 2 no
 * tienen fila en `ct_ips` — vs. muchísimos más a nivel de línea de detalle
 * (11% de las líneas de `rips_ap`, $4.651.600.354 de valor). Por eso ahora
 * se usa `fp.codigo_prestador` (el de la FACTURA, vía el `JOIN` de
 * `construirJoinFactura`) — mucho más confiable para atribuir "de qué
 * prestador es esto", y punto de coincidencia consistente con el resto de
 * módulos del proyecto (todos usan el `codigo_prestador` de `rips_af`).
 */
function construirUnionCrudo(tipos: TipoEspecifico[], fragmento: FragmentoFacturas): string {
  return tipos
    .map((t) => {
      const info = TABLA_TIPO[t];
      return `SELECT fp.codigo_prestador AS codigo_prestador, ${info.alias}.${info.columnaValor} AS valor
        FROM administrativo.${info.tabla} ${info.alias}
        ${construirJoinFactura(info.alias)}
        WHERE ${info.alias}.consecutivo_rips = ANY(${fragmento.ref})`;
    })
    .join(" UNION ALL ");
}

/**
 * CORRECCIÓN 2026-07-29 (mismo día, tras verificar contra un caso real):
 * `obtenerPorPrestador` y `obtenerPorMunicipio` usaban `JOIN` (INNER) contra
 * `ct_ips` por `codigo_prestador`. Hallazgo verificado con el contrato
 * EV-20001-2026-1 (CLINICA MEDICOS S.A., `ips` 803378, `codigo_prestador`
 * registrado en `ct_ips` = "200010053001"): el detalle real de las facturas
 * de ESE MISMO contrato aparece bajo 3 `codigo_prestador` distintos —
 * "200010053001" ($1.725M), "200010053003" ($2.770M, MÁS que el "001") y
 * "200010053005" ($64.5K) — pero `ct_ips` solo tiene una fila para el "001".
 * Con `INNER JOIN`, el 62% del valor real de ese prestador (todo lo de
 * "003"/"005") desaparecía en silencio de "Top 20 prestadores" — no se
 * mostraba mal, simplemente no existía en el resultado.
 *
 * Verificado que NO es un caso aislado: para `rips_ap` solo, año 2026, EPS
 * completa, 169.585 de 1.543.157 líneas (11%) tienen un `codigo_prestador`
 * sin fila en `ct_ips`, representando **$4.651.600.354 de $58.560.654.810
 * (7,9%)** del valor total — dinero real que "Top 20 prestadores"/"Top 20
 * municipios" venían ocultando por completo para CUALQUIER prestador con
 * sedes/códigos de habilitación no registrados como fila propia en `ct_ips`.
 *
 * FIX: `LEFT JOIN` + se agrupa también por `t.codigo_prestador` (no solo por
 * `ips.ips`), así un código sin match no se fusiona con otros códigos sin
 * match — cada uno aparece en su propia fila, etiquetado como "Código no
 * registrado: <codigo>", en vez de perderse. Esto es más honesto que ocultar
 * el dato, aunque estructuralmente lo correcto sería que TI registre esos
 * códigos de sede en `ct_ips` — reportado como pendiente en la KB.
 */
async function obtenerPorPrestador(tipos: TipoEspecifico[], fragmento: FragmentoFacturas): Promise<FilaImpactoPrestador[]> {
  const sql = `
    ${fragmento.cte}
    SELECT ips.ips AS ips, COALESCE(ips.razon_social, 'Código no registrado: ' || t.codigo_prestador) AS razon_social, SUM(t.valor) AS valor
    FROM (${construirUnionCrudo(tipos, fragmento)}) t
    LEFT JOIN administrativo.ct_ips ips ON ips.codigo_prestador = t.codigo_prestador
    GROUP BY ips.ips, ips.razon_social, t.codigo_prestador
    ORDER BY valor DESC
    LIMIT 20
  `;
  const result = await pool.query(sql, fragmento.params, `${SOURCE}/por-prestador`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    ips: r.ips === null || r.ips === undefined ? null : Number(r.ips),
    razonSocial: r.razon_social,
    valorTotal: Number(r.valor ?? 0),
  }));
}

async function obtenerPorMunicipio(tipos: TipoEspecifico[], fragmento: FragmentoFacturas): Promise<FilaImpactoMunicipio[]> {
  // A diferencia de `obtenerPorPrestador` (donde codigo_prestador → ips es
  // 1:1 vía índice único `ix_ct_ips_codigo_prestador`, así que agregar
  // t.codigo_prestador al GROUP BY es seguro), aquí VARIOS prestadores
  // distintos comparten el mismo municipio — agrupar directamente por
  // t.codigo_prestador partiría en pedazos la suma real de un municipio.
  // Por eso se arma una `clave` intermedia: el código de municipio real
  // cuando hay match, o un bucket aislado por código huérfano cuando no lo
  // hay (mismo hallazgo de "códigos de prestador no registrados en ct_ips"
  // documentado junto a `obtenerPorPrestador`).
  const sql = `
    ${fragmento.cte}
    SELECT MAX(municipio_codigo) AS municipio_codigo, MAX(municipio_nombre) AS municipio_nombre, SUM(valor) AS valor
    FROM (
      SELECT
        ips.municipio AS municipio_codigo,
        COALESCE(mun.descripcion, 'Sin identificar (código ' || t.codigo_prestador || ')') AS municipio_nombre,
        COALESCE(ips.municipio, 'SIN:' || t.codigo_prestador) AS clave,
        t.valor AS valor
      FROM (${construirUnionCrudo(tipos, fragmento)}) t
      LEFT JOIN administrativo.ct_ips ips ON ips.codigo_prestador = t.codigo_prestador
      LEFT JOIN administrativo.tb_municipio mun ON mun.municipio = ips.municipio
    ) sub
    GROUP BY clave
    ORDER BY valor DESC
    LIMIT 20
  `;
  const result = await pool.query(sql, fragmento.params, `${SOURCE}/por-municipio`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    municipioCodigo: r.municipio_codigo ?? "",
    municipioNombre: r.municipio_nombre ?? "Sin municipio",
    valorTotal: Number(r.valor ?? 0),
  }));
}

// -----------------------------------------------------------------------
// Opciones de filtros
// -----------------------------------------------------------------------

export async function getOpcionesFiltrosImpacto(): Promise<OpcionesFiltrosImpacto> {
  const sqlPrestadores = `
    SELECT DISTINCT ips.ips, ips.razon_social, ips.nit
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    WHERE c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND ips.codigo_prestador IS NOT NULL
    ORDER BY ips.razon_social ASC
  `;
  const sqlMunicipios = `
    SELECT DISTINCT mun.municipio AS codigo, mun.descripcion AS nombre
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    JOIN administrativo.tb_municipio mun ON mun.municipio = ips.municipio
    WHERE c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
    ORDER BY mun.descripcion ASC
  `;
  const sqlContratos = `
    SELECT DISTINCT c.numero_contrato
    FROM administrativo.ct_ips_contrato c
    WHERE c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
    ORDER BY c.numero_contrato ASC
  `;

  const [prestadoresResult, municipiosResult, contratosResult] = await Promise.all([
    pool.query(sqlPrestadores, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-prestador`),
    pool.query(sqlMunicipios, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-municipio`),
    pool.query(sqlContratos, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-contrato`),
  ]);

  const prestadores = (prestadoresResult?.rows ?? []).map((r: any) => ({
    ips: Number(r.ips),
    razonSocial: r.razon_social,
    nit: r.nit,
  }));
  const municipios = (municipiosResult?.rows ?? []).map((r: any) => ({ codigo: r.codigo, nombre: r.nombre }));
  const contratos = (contratosResult?.rows ?? []).map((r: any) => r.numero_contrato as string);

  // Años con datos: generado de forma fija (no se consulta la BD para esto)
  // porque otras tablas RIPS ya tienen registros con fechas corruptas
  // documentadas (año 7313 — ver CLAUDE.md sección 6), y no vale la pena
  // pagar una consulta adicional solo para listar años cuando el rango real
  // de operación de la EPS ya se verificó 2026-07-29 (2022 en adelante).
  const anioActual = new Date().getFullYear();
  const anios: number[] = [];
  for (let a = anioActual; a >= PRIMER_ANIO_CON_DATOS; a--) anios.push(a);

  return { prestadores, municipios, contratos, anios };
}

/**
 * Contratos vigentes de UN prestador puntual, con su municipio de
 * administración — agregado 2026-07-30 para el selector en cascada
 * Prestador → Contrato(s) → Municipio del cliente (pedido explícito del
 * usuario: buscar el prestador, que los contratos mostrados sean solo los
 * de ESE prestador, y que el municipio se muestre automáticamente según el
 * o los contratos elegidos). Usa `municipio_administracion`, no
 * `ct_ips.municipio` — mismo criterio ya corregido en el Módulo 2 (ver
 * KnowledgeBase/04-BaseDatos/Tablas.md, hallazgo 2026-07-30).
 */
export async function getContratosPrestador(ips: number): Promise<OpcionContratoPrestador[]> {
  const sql = `
    SELECT DISTINCT c.numero_contrato, c.municipio_administracion AS municipio_codigo, mun.descripcion AS municipio_nombre
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.tb_municipio mun ON mun.municipio = c.municipio_administracion
    WHERE c.ips = $1
      AND c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($2)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
    ORDER BY c.numero_contrato ASC
  `;
  const result = await pool.query(sql, [ips, CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/contratos-prestador`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    numeroContrato: r.numero_contrato,
    municipioCodigo: r.municipio_codigo,
    municipioNombre: r.municipio_nombre,
  }));
}

// -----------------------------------------------------------------------
// Consulta principal
// -----------------------------------------------------------------------

/**
 * `soloPorCodigo` — fix 2026-07-31 (reporte del usuario: "cuando doy dble
 * clic se demora mucho parece que se colgara" al abrir el drill-down Nivel 2
 * desde "Top 20 prestadores"). Causa: `abrirDrillPrestador` (en
 * `top-impacto-client.tsx`) llama a esta misma función fijando `ips` a UN
 * solo prestador, pero antes seguía ejecutando las 3 consultas secuenciales
 * completas — incluyendo `obtenerPorPrestador` y `obtenerPorMunicipio`, que
 * con `ips` ya fijo solo pueden devolver, respectivamente, ese mismo
 * prestador en el puesto 1 y su(s) propio(s) municipio(s): datos que el
 * modal de Nivel 2 NUNCA muestra (usa únicamente `top100`, ver
 * `drillNivel2.top100` en `top-impacto-client.tsx` y el comentario en
 * `types/top-impacto.ts` sobre por qué el Nivel 2 reutiliza
 * `ResultadoTopImpacto` completo). Es decir: 2 de las 3 consultas pesadas
 * (cada una ~3-10s sobre RIPS completo) se pagaban en cada doble clic sin
 * que su resultado se usara para nada.
 *
 * Con `soloPorCodigo: true` se salta esas 2 consultas y se devuelven arreglos
 * vacíos en `top20Prestadores`/`top20Municipios` — `kpis`/`top100`/
 * `top20Codigos` (lo único que el drill-down consume) se calculan exactamente
 * igual, con la misma `fragmento`/filtros, así que el resultado sigue siendo
 * 100% coherente con el valor de la barra que originó el clic.
 */
export async function getTopImpacto(
  filtros: FiltrosImpacto,
  opciones?: { soloPorCodigo?: boolean }
): Promise<ResultadoTopImpacto> {
  let codigoPrestador: string | null = null;
  if (filtros.ips) {
    const infoResult = await pool.query(
      `SELECT codigo_prestador FROM administrativo.ct_ips WHERE ips = $1 LIMIT 1`,
      [filtros.ips],
      `${SOURCE}/codigo-prestador`
    );
    codigoPrestador = infoResult?.rows?.[0]?.codigo_prestador ?? null;
  }

  const tipos = tiposSeleccionados(filtros.tipo);
  const fragmento = construirFragmentoFacturas(filtros, codigoPrestador);

  // SECUENCIAL, no Promise.all — corrección 2026-07-29 tras un
  // `TypeError: terminated` en producción. Cada una de estas 3 consultas ya
  // es pesada por sí sola (UNION ALL de hasta 3 tablas RIPS de cientos de
  // millones de filas, ~3-10s medidas con EXPLAIN ANALYZE); lanzarlas las 3 a
  // la vez contra el mismo proxy (una única instancia Node con un pool de
  // conexiones a Postgres, no esta app) multiplicaba la carga simultánea
  // sobre un servicio de recursos limitados (Render), lo que parece haber
  // provocado que el proxy cerrara la conexión a mitad de una respuesta
  // (`fetch` lo reporta como `TypeError: terminated`, no como un error HTTP
  // limpio). Ejecutarlas una a la vez es más lento en total pero muchísimo
  // más confiable — coherente con el resto del proyecto, que prioriza
  // consultas confiables sobre consultas rápidas cuando compiten.
  const crudasPorCodigo = await obtenerPorCodigo(tipos, fragmento);
  const top20Prestadores = opciones?.soloPorCodigo ? [] : await obtenerPorPrestador(tipos, fragmento);
  const top20Municipios = opciones?.soloPorCodigo ? [] : await obtenerPorMunicipio(tipos, fragmento);

  const valorTotalRadicado = crudasPorCodigo.reduce((acc, f) => acc + f.valor, 0);
  const totalRegistros = crudasPorCodigo.reduce((acc, f) => acc + f.cantidad, 0);

  // `crudasPorCodigo` ya viene ordenada desc por valor (ORDER BY en SQL) —
  // se conserva el orden al mapear.
  const todasLasFilas = crudasPorCodigo.map((c) => construirFilaTopImpacto(c, valorTotalRadicado));
  const top100 = todasLasFilas.slice(0, 100);
  const top20Codigos = top100.slice(0, 20);
  const kpis = calcularKpisTopImpacto(todasLasFilas, valorTotalRadicado, totalRegistros);

  return { filtros, kpis, top100, top20Codigos, top20Prestadores, top20Municipios };
}

// -----------------------------------------------------------------------
// Drill-down "de lo general a lo particular" (2026-07-30) — Nivel 3
// -----------------------------------------------------------------------

/** Cuántas facturas como máximo se envían al cliente (las más recientes) — mismo criterio y mismo número que `movimiento-rips-actions.ts` (LIMITE_FACTURAS_MOSTRADAS). */
const LIMITE_FACTURAS_IMPACTO = 500;

/**
 * Columna de fecha por tipo — mismo nombre ya verificado y usado en
 * `movimiento-rips-actions.ts` para servicios/medicamentos/insumos
 * (`fecha_procedimiento`/`fecha_dispensacion`/`fecha_atencion`). Para
 * "consultas" (`rips_ac`) se usa `fecha_consulta`, siguiendo la misma
 * convención de nombre "fecha_<evento del archivo RIPS>" que las otras 3
 * tablas — consistente con el estándar RIPS (Resolución 3374/2000, archivo
 * tipo AC) y con `codigo_consulta`/`valor_consulta` ya usados en
 * `TABLA_TIPO.consultas` de este mismo archivo.
 *
 * ⚠️ A diferencia de las otras 3 columnas (verificadas contra la BD real en
 * `movimiento-rips-actions.ts`), `fecha_consulta` para `rips_ac` NO se pudo
 * re-verificar contra `information_schema.columns` en esta sesión — el
 * entorno de ejecución no tuvo salida de red hacia el proxy (`pg-proxy.onrender.com`)
 * en el momento de escribir esta función. Verificar contra la BD real (o con
 * el primer uso real en producción) antes de confiar en el detalle de
 * facturas de "consultas" en este drill-down.
 */
const COLUMNA_FECHA_TIPO: Record<TipoEspecifico, string> = {
  servicios: "fecha_procedimiento",
  consultas: "fecha_consulta",
  medicamentos: "fecha_dispensacion",
  insumos: "fecha_atencion",
};

/** "servicios"/"consultas" no tienen columna de unidades propia — cada fila es un evento (`COUNT(*)`, mismo criterio que `obtenerMovimientoServicios`). "medicamentos"/"insumos" sí la tienen. */
const EXPRESION_CANTIDAD_TIPO: Record<TipoEspecifico, string> = {
  servicios: "COUNT(*)",
  consultas: "COUNT(*)",
  medicamentos: "SUM(am.numero_unidades)",
  insumos: "SUM(at2.cantidad)",
};

/**
 * Detalle factura-por-factura de UN código, para UN prestador puntual, ya
 * acotado por los mismos filtros (año, municipio, contrato) con los que se
 * calculó el Nivel 2 — pedido del usuario 2026-07-30: "llevarme por doble
 * clic a una información más detallada hasta las facturas". Reutiliza
 * `construirFragmentoFacturas` (misma CTE año-acotada del resto del módulo)
 * en vez de la vigencia de contrato que usa `getMovimientoRipsCodigo` — así
 * el total de este Nivel 3 es coherente con el Nivel 2/el gráfico, que
 * también están acotados por año, no por vigencia.
 */
export async function getFacturasCodigoImpacto(
  filtros: FiltrosImpacto,
  tipo: TipoEspecifico,
  codigo: string
): Promise<ResultadoFacturasImpacto> {
  if (!filtros.ips) {
    throw new Error("Se requiere un prestador (ips) para consultar el detalle de facturas.");
  }

  const infoResult = await pool.query(
    `SELECT codigo_prestador, razon_social FROM administrativo.ct_ips WHERE ips = $1 LIMIT 1`,
    [filtros.ips],
    `${SOURCE}/info-prestador-facturas`
  );
  const info = infoResult?.rows?.[0];
  const codigoPrestador: string | null = info?.codigo_prestador ?? null;
  const razonSocial = info?.razon_social ?? "Prestador";

  if (!codigoPrestador) {
    return {
      ips: filtros.ips,
      razonSocial,
      codigoPrestador: "",
      codigo,
      descripcion: codigo,
      tipo,
      anio: filtros.anio,
      totalCantidad: 0,
      totalValor: 0,
      totalFacturas: 0,
      facturas: [],
    };
  }

  const fragmento = construirFragmentoFacturas(filtros, codigoPrestador);
  const info2 = TABLA_TIPO[tipo];
  const params = [...fragmento.params, codigo];
  const idxCodigo = params.length;

  const joinFallback = info2.catalogoFallback
    ? `LEFT JOIN administrativo.${info2.catalogoFallback} fb ON fb.codigo_interno = ${info2.alias}.${info2.columnaCodigo}`
    : "";
  const columnaDescripcion = info2.catalogoFallback
    ? `COALESCE(cat.${info2.columnaCatalogoDescripcion}, fb.descripcion)`
    : `cat.${info2.columnaCatalogoDescripcion}`;
  const columnaFecha = COLUMNA_FECHA_TIPO[tipo];

  // `joinFacturaCanonica` (fix 2026-07-30): sin esto, una factura recargada
  // en varios lotes aparecería MÚLTIPLES VECES en esta lista (una fila por
  // lote) con cantidad/valor inflados — ver rips-dedup.ts y el caso real
  // verificado (MV06370: $850.000 mostrados vs. $170.000 reales, 5 lotes).
  const sql = `
    ${fragmento.cte}
    SELECT ${info2.alias}.numero_factura AS numero_factura, ${info2.alias}.${columnaFecha} AS fecha,
      ${EXPRESION_CANTIDAD_TIPO[tipo]} AS cantidad, SUM(${info2.alias}.${info2.columnaValor}) AS valor,
      MAX(${columnaDescripcion}) AS descripcion
    FROM administrativo.${info2.tabla} ${info2.alias}
    ${joinFacturaCanonica(info2.alias)}
    LEFT JOIN administrativo.${info2.catalogo} cat ON cat.codigo_interno = ${info2.alias}.${info2.columnaCodigo}
    ${joinFallback}
    WHERE ${info2.alias}.${info2.columnaCodigo} = $${idxCodigo}
      AND ${info2.alias}.consecutivo_rips = ANY(${fragmento.ref})
    GROUP BY ${info2.alias}.numero_factura, ${info2.alias}.${columnaFecha}
    ORDER BY ${info2.alias}.${columnaFecha} DESC NULLS LAST
  `;
  const result = await pool.query(sql, params, `${SOURCE}/facturas-codigo`);
  const rows: any[] = result?.rows ?? [];

  const todas: FilaFacturaImpacto[] = rows.map((r) => ({
    numeroFactura: r.numero_factura,
    fecha: r.fecha,
    cantidad: Number(r.cantidad ?? 0),
    valor: Number(r.valor ?? 0),
  }));
  const descripcion = rows.find((r) => r.descripcion)?.descripcion ?? codigo;
  const totalCantidad = todas.reduce((acc, f) => acc + f.cantidad, 0);
  const totalValor = todas.reduce((acc, f) => acc + f.valor, 0);
  const facturas = todas.slice(0, LIMITE_FACTURAS_IMPACTO);

  return {
    ips: filtros.ips,
    razonSocial,
    codigoPrestador,
    codigo,
    descripcion,
    tipo,
    anio: filtros.anio,
    totalCantidad,
    totalValor,
    totalFacturas: todas.length,
    facturas,
  };
}
