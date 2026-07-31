"use server";

/**
 * Server Actions del Módulo 2 — Comparativo entre Prestadores.
 *
 * Fuente de datos: BD real de ARYUWIS (esquema administrativo), SOLO
 * LECTURA, en vivo — mismo patrón que el Módulo 1 (sin ETL, sin snapshot).
 *
 * Regla de negocio central (pedida explícitamente por el usuario
 * 2026-07-28): comparar tarifas de un mismo código (CUPS/CUM/insumo) SOLO
 * entre prestadores del MISMO municipio. Comparar entre municipios distintos
 * mezclaría la variabilidad "por ubicación" (legítima, el contrato se negoció
 * distinto según dónde se ofertó) con la variabilidad "por negociación" (la
 * que sí interesa detectar) — ver KnowledgeBase/05-ReglasNegocio/Contratación.md.
 *
 * Reutiliza dos hallazgos ya validados del Módulo 1:
 *   1. Las FKs consecutivo_cup/consecutivo_medicamento/consecutivo_insumo NO
 *      son confiables — el cruce con el maestro real es siempre por código
 *      (d.codigo_tarifa = <maestro>.codigo_interno).
 *   2. El código de municipio (estilo DANE) resuelve su nombre y su
 *      departamento vía un doble self-join sobre tb_municipio (tb_municipio.
 *      departamento es OTRO código de tb_municipio.municipio, no texto libre)
 *      — patrón ya usado en el resto del ecosistema Dusakawi (ver CLAUDE.md).
 *
 * Corrección 2026-07-30 — el "municipio" de agrupación es el del CONTRATO,
 * no el del prestador: se usa `ct_ips_contrato.municipio_administracion`
 * (municipio bajo el cual se administra ESE contrato específico), no
 * `ct_ips.municipio` (municipio de registro de la sede del prestador, fijo
 * por `ips`). Un mismo prestador puede tener contratos administrados en
 * municipios distintos al de su sede registrada — verificado con datos
 * reales (GYO MEDICAL I.P.S. S.A.S., ips 801870: registrado en Riohacha
 * pero con contratos administrados en Maicao y San Juan Del Cesar; a escala
 * de toda la BD, 91 de 279 contratos vigentes —~33%— difieren). Usar
 * ct_ips.municipio mezclaba en un mismo grupo tarifas negociadas para
 * municipios distintos — justo lo que esta regla de negocio busca evitar.
 * Ver KnowledgeBase/04-BaseDatos/Tablas.md y Relaciones.md para el detalle.
 */

import { pool } from "@/lib/db";
import { resolverValorFinal } from "@/lib/negociacion/formato";
import { calcularEstadisticas, calcularVariacionPct, dedupMejorPrecio, filtrarYRecortarPorEstados, amplitudSegunReferencia } from "@/lib/negociacion/comparativo";
import { CONTRATOS_EXCLUIDOS_MIGRACION } from "@/lib/negociacion/constantes";
import { LIMITE_FILAS_EXPORTACION } from "@/lib/negociacion/exportar";
import type {
  TipoComparativo,
  OpcionMunicipio,
  FilaComparativoCodigo,
  ParametrosComparativoMunicipio,
  ResultadoPaginadoComparativo,
  ReferenciaVariacion,
  UmbralesSemaforo,
  NivelSemaforo,
} from "@/types/comparativo";

const SOURCE = "comparativo";

/** Un límite defensivo, no una paginación real de negocio — una sola combinación municipio+tipo no debería acercarse a esto. */
const LIMITE_FILAS_CRUDAS = 200_000;
/** Cuántos grupos (municipio+código) devolver como máximo en el buscador por código, para no saturar la UI en códigos muy genéricos. */
const LIMITE_GRUPOS_BUSQUEDA_CODIGO = 300;

interface ConfigTipo {
  columnaTarifario: "consecutivo_tarifario_servicio" | "consecutivo_tarifario_medicamento" | "consecutivo_tarifario_insumo";
  tablaMaestro: string;
  aliasMaestro: string;
}

const CONFIG_TIPO: Record<TipoComparativo, ConfigTipo> = {
  servicios: {
    columnaTarifario: "consecutivo_tarifario_servicio",
    tablaMaestro: "administrativo.tb_cup",
    aliasMaestro: "mtr",
  },
  medicamentos: {
    columnaTarifario: "consecutivo_tarifario_medicamento",
    tablaMaestro: "administrativo.tb_medicamento",
    aliasMaestro: "mtr",
  },
  insumos: {
    columnaTarifario: "consecutivo_tarifario_insumo",
    tablaMaestro: "administrativo.tb_insumo",
    aliasMaestro: "mtr",
  },
};

interface FilaCruda {
  ips: number;
  razonSocial: string;
  nit: string;
  numeroContrato: string;
  consecutivoContrato: number;
  codigoTarifa: string;
  descripcion: string;
  valorFinal: number;
}

function calcularValorFinalFila(r: any): number {
  const valor = Number(r.valor ?? r.valor_servicio ?? 0);
  const valorBase = Number(r.valor_base ?? 0);
  const valorPactado = Number(r.valor_pactado ?? 0);
  const porcentajeTarifa = Number(r.porcentaje_tarifa ?? 0);
  return resolverValorFinal({ valor, valorBase, valorPactado, porcentajeTarifa });
}

function mapFilaCruda(r: any): FilaCruda {
  return {
    ips: Number(r.ips),
    razonSocial: r.razon_social,
    nit: r.nit,
    numeroContrato: r.numero_contrato,
    consecutivoContrato: Number(r.consecutivo_contrato),
    codigoTarifa: r.codigo_tarifa,
    descripcion: r.descripcion_maestro ?? r.descripcion ?? r.codigo_tarifa,
    valorFinal: calcularValorFinalFila(r),
  };
}

/** Arma la FilaComparativoCodigo (estadísticas + prestadores) a partir de un grupo ya deduplicado por mejor precio. */
function construirFilaComparativo(
  codigoTarifa: string,
  filas: FilaCruda[],
  municipioCodigo: string,
  municipioNombre: string,
  departamentoNombre: string
): FilaComparativoCodigo {
  const valores = filas.map((f) => f.valorFinal);
  const stats = calcularEstadisticas(valores);
  const descripcion = filas[0]?.descripcion ?? codigoTarifa;

  return {
    codigoTarifa,
    descripcion,
    municipioCodigo,
    municipioNombre,
    departamentoNombre,
    cantidadPrestadores: filas.length,
    minimo: stats.minimo,
    maximo: stats.maximo,
    promedio: stats.promedio,
    mediana: stats.mediana,
    amplitudPctPromedio: stats.amplitudPctPromedio,
    amplitudPctMediana: stats.amplitudPctMediana,
    prestadores: filas
      .map((f) => ({
        ips: f.ips,
        razonSocial: f.razonSocial,
        nit: f.nit,
        numeroContrato: f.numeroContrato,
        consecutivoContrato: f.consecutivoContrato,
        valorFinal: f.valorFinal,
        // Se calculan las dos referencias — el promedio es sensible a
        // valores atípicos (un solo prestador muy caro/barato desplaza el
        // promedio de todo el grupo, ver KnowledgeBase/05-ReglasNegocio/
        // Contratación.md); la mediana no. El usuario elige cuál mirar en
        // la UI sin volver a consultar la BD.
        variacionPctPromedio: calcularVariacionPct(f.valorFinal, stats.promedio),
        variacionPctMediana: calcularVariacionPct(f.valorFinal, stats.mediana),
      }))
      .sort((a, b) => a.valorFinal - b.valorFinal),
  };
}

// -----------------------------------------------------------------------
// Municipios disponibles para comparar (>= 2 prestadores vigentes con ese tipo)
// -----------------------------------------------------------------------

export async function getOpcionesMunicipios(tipo: TipoComparativo): Promise<OpcionMunicipio[]> {
  const cfg = CONFIG_TIPO[tipo];

  const sql = `
    SELECT
      munA.municipio AS municipio_codigo,
      munA.descripcion AS municipio_nombre,
      depA.municipio AS departamento_codigo,
      depA.descripcion AS departamento_nombre,
      COUNT(DISTINCT c.ips) AS cantidad_prestadores
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    -- Corrección 2026-07-30: se agrupaba por ips.municipio (municipio de
    -- registro/sede del prestador, fijo por ips), no por el municipio bajo el
    -- cual se administra CADA contrato (c.municipio_administracion). Un mismo
    -- prestador puede tener contratos administrados en municipios distintos
    -- al de su sede registrada (verificado: 91 de 279 contratos vigentes,
    -- ~33%, tienen municipio_administracion != ips.municipio — caso real
    -- reportado por el usuario: GYO MEDICAL I.P.S. S.A.S., ips 801870,
    -- registrado en Riohacha (44001) pero con contratos administrados en
    -- Maicao (44430) y San Juan Del Cesar (44650)). Agrupar por ips.municipio
    -- mezclaba tarifas negociadas para municipios distintos en un solo grupo
    -- de comparación — justo el problema que esta regla de negocio busca
    -- evitar (ver KnowledgeBase/05-ReglasNegocio/Contratación.md).
    JOIN administrativo.tb_municipio munA ON munA.municipio = c.municipio_administracion
    JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento
    JOIN administrativo.tb_tarifario_propio_detalle d ON d.consecutivo_tarifa = c.${cfg.columnaTarifario}
    JOIN ${cfg.tablaMaestro} ${cfg.aliasMaestro} ON ${cfg.aliasMaestro}.codigo_interno = d.codigo_tarifa
    WHERE c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
    GROUP BY munA.municipio, munA.descripcion, depA.municipio, depA.descripcion
    HAVING COUNT(DISTINCT c.ips) >= 2
    ORDER BY depA.descripcion ASC, munA.descripcion ASC
  `;

  const result = await pool.query(sql, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-municipio-${tipo}`);
  const rows: any[] = result?.rows ?? [];

  return rows.map((r) => ({
    municipioCodigo: r.municipio_codigo,
    municipioNombre: r.municipio_nombre,
    departamentoCodigo: r.departamento_codigo,
    departamentoNombre: r.departamento_nombre,
    cantidadPrestadores: Number(r.cantidad_prestadores),
  }));
}

// -----------------------------------------------------------------------
// Vista "Comparativo por municipio": todos los códigos con >= 2 prestadores
// -----------------------------------------------------------------------

/**
 * Fetch + agregación cruda (sin filtrar por estado, sin ordenar, sin
 * paginar) — reutilizada por `getComparativoPorMunicipio` (que sí filtra/
 * ordena/pagina) y por la exportación completa (que filtra/ordena pero NUNCA
 * pagina, porque el objetivo es un informe con TODO el resultado).
 */
async function construirGruposMunicipio(
  municipioCodigo: string,
  tipo: TipoComparativo,
  busqueda?: string
): Promise<{ grupos: FilaComparativoCodigo[]; municipioNombre: string; departamentoNombre: string }> {
  const cfg = CONFIG_TIPO[tipo];
  const sqlParams: unknown[] = [CONTRATOS_EXCLUIDOS_MIGRACION, municipioCodigo];
  let condicionBusqueda = "";
  if (busqueda?.trim()) {
    sqlParams.push(`%${busqueda.trim()}%`);
    const idx = sqlParams.length;
    condicionBusqueda = `AND (d.codigo_tarifa ILIKE $${idx} OR d.descripcion ILIKE $${idx} OR ${cfg.aliasMaestro}.descripcion ILIKE $${idx})`;
  }

  const sql = `
    SELECT
      c.ips, ips.razon_social, ips.nit, c.numero_contrato, c.consecutivo_contrato,
      d.codigo_tarifa, ${cfg.aliasMaestro}.descripcion AS descripcion_maestro,
      d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.porcentaje_tarifa
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    JOIN administrativo.tb_tarifario_propio_detalle d ON d.consecutivo_tarifa = c.${cfg.columnaTarifario}
    JOIN ${cfg.tablaMaestro} ${cfg.aliasMaestro} ON ${cfg.aliasMaestro}.codigo_interno = d.codigo_tarifa
    -- Corrección 2026-07-30: filtrar por c.municipio_administracion (municipio
    -- bajo el cual se administra ESTE contrato), no por ips.municipio (sede
    -- registrada del prestador, fija). Ver detalle en getOpcionesMunicipios.
    WHERE c.municipio_administracion = $2
      AND c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
      ${condicionBusqueda}
    LIMIT ${LIMITE_FILAS_CRUDAS}
  `;

  const [resultFilas, resultMunicipio] = await Promise.all([
    pool.query(sql, sqlParams, `${SOURCE}/municipio-${tipo}`),
    obtenerInfoMunicipio(municipioCodigo),
  ]);

  // Se descartan filas con valorFinal <= 0: no son un dato faltante, son
  // ítems de contratos capitados donde ese servicio puntual no se tarifa por
  // evento (va incluido en el valor per cápita) — verificado 2026-07-28 con
  // el municipio de Valledupar (código 970101 y otros mostraban 0 en varios
  // prestadores mientras otros tenían precio real, lo que inflaba la
  // "amplitud" a >500% de forma engañosa). Compararlos como si fueran $0
  // reales generaría falsos críticos en el semáforo.
  const crudas: FilaCruda[] = (resultFilas?.rows ?? [])
    .map(mapFilaCruda)
    .filter((f: FilaCruda) => f.valorFinal > 0);
  const deduplicadas = dedupMejorPrecio(crudas);

  const porCodigo = new Map<string, FilaCruda[]>();
  for (const fila of deduplicadas) {
    const lista = porCodigo.get(fila.codigoTarifa) ?? [];
    lista.push(fila);
    porCodigo.set(fila.codigoTarifa, lista);
  }

  const municipioNombre = resultMunicipio?.municipioNombre ?? municipioCodigo;
  const departamentoNombre = resultMunicipio?.departamentoNombre ?? "—";

  const grupos: FilaComparativoCodigo[] = [];
  for (const [codigoTarifa, filas] of porCodigo) {
    if (filas.length < 2) continue; // solo interesa donde SÍ hay más de un prestador para comparar
    grupos.push(construirFilaComparativo(codigoTarifa, filas, municipioCodigo, municipioNombre, departamentoNombre));
  }

  return { grupos, municipioNombre, departamentoNombre };
}

export async function getComparativoPorMunicipio(
  municipioCodigo: string,
  tipo: TipoComparativo,
  params: ParametrosComparativoMunicipio
): Promise<ResultadoPaginadoComparativo<FilaComparativoCodigo>> {
  // El cap de pageSize es alto a propósito (no solo 20-25 de la UI normal):
  // el Route Handler de exportación reutiliza esta MISMA función pidiendo
  // pageSize = LIMITE_FILAS_EXPORTACION para traer "todo" en una sola
  // "página", en vez de duplicar la lógica de filtro/orden en otro lugar.
  const pageSize = Math.min(Math.max(params.pageSize || 25, 1), LIMITE_FILAS_EXPORTACION);
  const page = Math.max(params.page || 1, 1);

  const { grupos: gruposCrudos } = await construirGruposMunicipio(municipioCodigo, tipo, params.busqueda);

  // Corrección 2026-07-28 (reportada por el usuario): filtrar solo el CÓDIGO
  // (mostrarlo si al menos 1 prestador matcheaba) no bastaba — al desplegar
  // el código seguían apareciendo TODOS sus prestadores, incluidos los de
  // otros estados no seleccionados. `filtrarYRecortarPorEstados` filtra Y
  // recorta la lista de prestadores de cada código a la vez (ver
  // src/lib/negociacion/comparativo.ts) — mínimo/máximo/promedio/mediana/
  // amplitud se dejan calculados sobre el grupo COMPLETO a propósito (son el
  // contexto real de mercado, no deberían cambiar por mirar un subconjunto).
  const grupos = filtrarYRecortarPorEstados(gruposCrudos, params.referencia, params.umbrales, params.estadosFiltro);

  // Variabilidad más alta primero — es la vista más útil para negociación.
  // Corrección 2026-07-29: ordenar por la Amplitud que coincide con la
  // referencia elegida en pantalla ("Comparar contra"), no siempre contra el
  // promedio — mismo criterio que se usa para mostrarla en la tabla.
  grupos.sort((a, b) => amplitudSegunReferencia(b, params.referencia) - amplitudSegunReferencia(a, params.referencia));

  const total = grupos.length;
  const offset = (page - 1) * pageSize;
  const filasPagina = grupos.slice(offset, offset + pageSize);

  return {
    filas: filasPagina,
    total,
    page,
    pageSize,
    totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Variante para exportación: SIEMPRE devuelve el resultado COMPLETO (sin
 * paginar), ya filtrado por estado y ordenado — usada por
 * `/api/export/comparativo`. Reutiliza `construirGruposMunicipio` para no
 * duplicar la query ni la agregación.
 */
export async function getComparativoMunicipioCompleto(
  municipioCodigo: string,
  tipo: TipoComparativo,
  busqueda: string | undefined,
  referencia: ReferenciaVariacion,
  umbrales: UmbralesSemaforo,
  estadosFiltro?: NivelSemaforo[]
): Promise<{ grupos: FilaComparativoCodigo[]; municipioNombre: string; departamentoNombre: string }> {
  const { grupos: gruposCrudos, municipioNombre, departamentoNombre } = await construirGruposMunicipio(
    municipioCodigo,
    tipo,
    busqueda
  );
  const grupos = filtrarYRecortarPorEstados(gruposCrudos, referencia, umbrales, estadosFiltro);
  grupos.sort((a, b) => amplitudSegunReferencia(b, referencia) - amplitudSegunReferencia(a, referencia));
  return { grupos, municipioNombre, departamentoNombre };
}

export async function obtenerInfoMunicipio(municipioCodigo: string): Promise<{ municipioNombre: string; departamentoNombre: string } | null> {
  const sql = `
    SELECT munA.descripcion AS municipio_nombre, depA.descripcion AS departamento_nombre
    FROM administrativo.tb_municipio munA
    JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento
    WHERE munA.municipio = $1
    LIMIT 1
  `;
  const result = await pool.query(sql, [municipioCodigo], `${SOURCE}/info-municipio`);
  const r = result?.rows?.[0];
  if (!r) return null;
  return { municipioNombre: r.municipio_nombre, departamentoNombre: r.departamento_nombre };
}

// -----------------------------------------------------------------------
// Vista "Buscar código específico": un código, agrupado por municipio
// -----------------------------------------------------------------------

export async function getComparativoPorCodigo(
  codigoBusqueda: string,
  tipo: TipoComparativo,
  municipioCodigo?: string,
  referencia: ReferenciaVariacion = "promedio"
): Promise<FilaComparativoCodigo[]> {
  const busqueda = codigoBusqueda.trim();
  if (!busqueda) return [];

  const cfg = CONFIG_TIPO[tipo];
  const sqlParams: unknown[] = [CONTRATOS_EXCLUIDOS_MIGRACION, `%${busqueda}%`];
  let condicionMunicipio = "";
  if (municipioCodigo) {
    sqlParams.push(municipioCodigo);
    // Corrección 2026-07-30: filtrar/agrupar por el municipio de administración
    // del CONTRATO, no por el municipio de registro del prestador — ver
    // detalle completo en getOpcionesMunicipios más arriba en este archivo.
    condicionMunicipio = `AND c.municipio_administracion = $${sqlParams.length}`;
  }

  const sql = `
    SELECT
      c.ips, ips.razon_social, ips.nit, c.numero_contrato, c.consecutivo_contrato,
      c.municipio_administracion AS municipio_codigo, munA.descripcion AS municipio_nombre, depA.descripcion AS departamento_nombre,
      d.codigo_tarifa, ${cfg.aliasMaestro}.descripcion AS descripcion_maestro,
      d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.porcentaje_tarifa
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    JOIN administrativo.tb_municipio munA ON munA.municipio = c.municipio_administracion
    JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento
    JOIN administrativo.tb_tarifario_propio_detalle d ON d.consecutivo_tarifa = c.${cfg.columnaTarifario}
    JOIN ${cfg.tablaMaestro} ${cfg.aliasMaestro} ON ${cfg.aliasMaestro}.codigo_interno = d.codigo_tarifa
    WHERE c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
      AND (d.codigo_tarifa ILIKE $2 OR d.descripcion ILIKE $2 OR ${cfg.aliasMaestro}.descripcion ILIKE $2)
      ${condicionMunicipio}
    ORDER BY depA.descripcion ASC, munA.descripcion ASC, d.codigo_tarifa ASC
    LIMIT 20000
  `;

  const result = await pool.query(sql, sqlParams, `${SOURCE}/buscar-codigo-${tipo}`);
  const rows: any[] = result?.rows ?? [];

  // Agrupar por (municipio + código) — la comparación siempre es dentro del mismo municipio.
  const porGrupo = new Map<
    string,
    { municipioCodigo: string; municipioNombre: string; departamentoNombre: string; codigoTarifa: string; filas: FilaCruda[] }
  >();

  for (const r of rows) {
    const clave = `${r.municipio_codigo}__${r.codigo_tarifa}`;
    const grupo =
      porGrupo.get(clave) ??
      ({
        municipioCodigo: r.municipio_codigo,
        municipioNombre: r.municipio_nombre,
        departamentoNombre: r.departamento_nombre,
        codigoTarifa: r.codigo_tarifa,
        filas: [],
      } as { municipioCodigo: string; municipioNombre: string; departamentoNombre: string; codigoTarifa: string; filas: FilaCruda[] });
    const filaCruda = mapFilaCruda(r);
    if (filaCruda.valorFinal > 0) {
      // Ver comentario equivalente en getComparativoPorMunicipio: valorFinal
      // <= 0 es un ítem de contrato capitado sin tarifa por evento, no un
      // precio real comparable.
      grupo.filas.push(filaCruda);
    }
    porGrupo.set(clave, grupo);
  }

  const resultado: FilaComparativoCodigo[] = [];
  for (const grupo of porGrupo.values()) {
    const deduplicadas = dedupMejorPrecio(grupo.filas);
    if (deduplicadas.length < 2) continue; // igual que la otra vista: solo interesa donde hay comparación real
    resultado.push(
      construirFilaComparativo(
        grupo.codigoTarifa,
        deduplicadas,
        grupo.municipioCodigo,
        grupo.municipioNombre,
        grupo.departamentoNombre
      )
    );
  }

  resultado.sort((a, b) => amplitudSegunReferencia(b, referencia) - amplitudSegunReferencia(a, referencia));
  return resultado.slice(0, LIMITE_GRUPOS_BUSQUEDA_CODIGO);
}
