"use server";

/**
 * Server Action de "Movimientos RIPS" — consulta puntual (código + prestador)
 * pedida desde el acordeón de "Perfil Competitivo del Prestador" (2026-07-29):
 * saber cuántas veces se ha radicado un código específico y en qué facturas,
 * para poder ir a auditar el movimiento real en ARYUWIS/RIPS.
 *
 * Solo lectura. Mismo criterio de rendimiento que Módulo 4 (Consumo y
 * Frecuencia): la lista de facturas del prestador (`rips_af`, filtrada por
 * `codigo_prestador` — Seq Scan, sin índice por prestador, pero rápido
 * porque `rips_af` es la tabla RIPS más chica) se usa para acotar
 * `rips_ap`/`rips_am`/`rips_at` por `consecutivo_rips` (SÍ indexado en las 3).
 *
 * CORRECCIÓN 2026-07-29 (mismo día): la primera versión resolvía la lista de
 * `consecutivo_rips` del prestador en la aplicación (Node) y la volvía a
 * enviar como parámetro (un array de miles/decenas de miles de bigints) en
 * una SEGUNDA consulta HTTP al proxy — para un prestador con muchas facturas
 * históricas, ese array serializado a JSON superaba el límite de tamaño de
 * payload del proxy, y el usuario lo vio como `Error: El servicio proxy de
 * base de datos no está disponible (413)`. Además, el viaje de ida y vuelta
 * de un array tan grande por HTTP era el principal responsable de la
 * lentitud reportada ("se demora mucho la consulta").
 *
 * FIX: se fusionó todo en UNA sola consulta SQL por tabla, con el filtro de
 * `rips_af` como subconsulta correlacionada — el array de `consecutivo_rips`
 * nunca sale de Postgres, se resuelve enteramente del lado del motor.
 * Verificado con `EXPLAIN ANALYZE` (prestador con 14.458 facturas
 * históricas): ~3s totales, ejecutados enteramente en el servidor de BD, sin
 * el costo de ida y vuelta del array por la red — mismo resultado, sin el
 * riesgo de 413 y notablemente más rápido en la práctica.
 */

import { pool } from "@/lib/db";
import { CONTRATOS_EXCLUIDOS_MIGRACION } from "@/lib/negociacion/constantes";
import { sqlFacturasCanonicas, joinFacturaCanonica } from "@/lib/negociacion/rips-dedup";
import type { TipoComparativo } from "@/types/comparativo";
import type { ResultadoMovimientoRips, FilaFacturaMovimientoRips } from "@/types/movimiento-rips";

const SOURCE = "movimiento-rips";
/** Cuántas facturas como máximo se envían al cliente (las más recientes) — ver nota en getMovimientoRipsCodigo sobre por qué se acota la lista y no el total. */
const LIMITE_FACTURAS_MOSTRADAS = 500;

/**
 * Subconsulta reutilizada en las 3 tablas — nunca se materializa en la
 * aplicación (Node), Postgres la resuelve internamente dentro del mismo plan.
 *
 * CRÍTICO: `consecutivo_rips = ANY(ARRAY(subquery))`, NO `consecutivo_rips IN
 * (subquery)` — verificado con `EXPLAIN ANALYZE` que son formas NO
 * equivalentes en la práctica para este caso: `IN (subquery)` hizo que el
 * planificador eligiera un `Merge Semi Join` con `Parallel Seq Scan` sobre
 * las 171M filas de `rips_ap` (¡42 segundos!, para un código de alto
 * volumen), mientras que `= ANY(ARRAY(subquery))` fuerza un `Index Scan`
 * usando `rips_ap_idx_rips` (~2 segundos, mismo resultado). Si en el futuro
 * se toca esta consulta, mantener la forma `= ANY(ARRAY(...))`.
 */
const CONDICION_FACTURAS_PRESTADOR = "codigo_prestador = $1 AND fecha_anula IS NULL";

const SUBQUERY_FACTURAS_PRESTADOR = `
  ARRAY(SELECT consecutivo_rips FROM administrativo.rips_af WHERE ${CONDICION_FACTURAS_PRESTADOR})
`;

/**
 * CTE de deduplicación — hallazgo crítico 2026-07-30 (ver
 * `src/lib/negociacion/rips-dedup.ts` y KnowledgeBase/04-BaseDatos/Tablas.md):
 * una misma factura real puede aparecer repetida en varios lotes
 * (`consecutivo_rips`) de `rips_af` por recargas de RIPS no limpiadas. Sin
 * esta CTE, `obtenerMovimiento*` contaba cada factura una vez POR LOTE en
 * vez de una sola vez (verificado hasta 13x de inflación en casos reales).
 * Se antepone a las 3 consultas de este módulo.
 */
const CTE_FACTURAS_CANONICAS = `WITH facturas_canonicas AS MATERIALIZED (${sqlFacturasCanonicas(CONDICION_FACTURAS_PRESTADOR)})`;

interface FilaCrudaFactura {
  numeroFactura: string;
  fecha: string | null;
  cantidad: number;
  valor: number;
}

/**
 * Vigencia (unión de fecha_inicio mínima / fecha_terminacion máxima) de los
 * contratos ACTIVOS HOY de este prestador — pedido del usuario 2026-07-29:
 * "que las facturas sean 2026... que sean acordes con el contrato". En vez
 * de hardcodear el año 2026 (se rompería en 2027), se toma la vigencia real
 * del contrato vigente (mismo criterio de vigencia que `construirGruposTodosMunicipios`
 * en dashboard-riesgo-actions.ts) y se usa como rango de fechas del RIPS —
 * hoy coincide con el año 2026 porque así está vigente el contrato actual,
 * pero se ajusta solo cuando cambie la vigencia real en la BD.
 */
async function obtenerVigenciaContrato(ips: number): Promise<{ fechaInicio: string; fechaTerminacion: string } | null> {
  const sql = `
    SELECT MIN(fecha_inicio) AS fecha_inicio, MAX(fecha_terminacion) AS fecha_terminacion
    FROM administrativo.ct_ips_contrato c
    WHERE c.ips = $1
      AND c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($2)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
  `;
  const result = await pool.query(sql, [ips, CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/vigencia-contrato`);
  const row = result?.rows?.[0];
  if (!row?.fecha_inicio || !row?.fecha_terminacion) return null;
  return { fechaInicio: row.fecha_inicio, fechaTerminacion: row.fecha_terminacion };
}

async function obtenerMovimientoServicios(
  codigoPrestador: string,
  codigoTarifa: string,
  vigencia: { fechaInicio: string; fechaTerminacion: string } | null
): Promise<FilaCrudaFactura[]> {
  // rips_ap no tiene columna de cantidad — cada fila ES un evento/unidad
  // (mismo criterio ya usado en obtenerConsumoServicios de Módulo 4).
  const params: unknown[] = [codigoPrestador, codigoTarifa];
  const filtroFecha = vigencia ? construirFiltroFecha("fecha_procedimiento", vigencia, params) : "";
  const sql = `
    ${CTE_FACTURAS_CANONICAS}
    SELECT rips_ap.numero_factura AS numero_factura, fecha_procedimiento AS fecha, COUNT(*) AS cantidad, SUM(valor_procedimiento) AS valor
    FROM administrativo.rips_ap
    ${joinFacturaCanonica("rips_ap")}
    WHERE codigo_procedimiento = $2
      AND consecutivo_rips = ANY(${SUBQUERY_FACTURAS_PRESTADOR})
      ${filtroFecha}
    GROUP BY rips_ap.numero_factura, fecha_procedimiento
  `;
  const result = await pool.query(sql, params, `${SOURCE}/movimiento-servicios`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    numeroFactura: r.numero_factura,
    fecha: r.fecha,
    cantidad: Number(r.cantidad ?? 0),
    valor: Number(r.valor ?? 0),
  }));
}

async function obtenerMovimientoMedicamentos(
  codigoPrestador: string,
  codigoTarifa: string,
  vigencia: { fechaInicio: string; fechaTerminacion: string } | null
): Promise<FilaCrudaFactura[]> {
  const params: unknown[] = [codigoPrestador, codigoTarifa];
  const filtroFecha = vigencia ? construirFiltroFecha("fecha_dispensacion", vigencia, params) : "";
  const sql = `
    ${CTE_FACTURAS_CANONICAS}
    SELECT rips_am.numero_factura AS numero_factura, fecha_dispensacion AS fecha, SUM(numero_unidades) AS cantidad, SUM(valor_total_medicamento) AS valor
    FROM administrativo.rips_am
    ${joinFacturaCanonica("rips_am")}
    WHERE codigo_medicamento = $2
      AND consecutivo_rips = ANY(${SUBQUERY_FACTURAS_PRESTADOR})
      ${filtroFecha}
    GROUP BY rips_am.numero_factura, fecha_dispensacion
  `;
  const result = await pool.query(sql, params, `${SOURCE}/movimiento-medicamentos`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    numeroFactura: r.numero_factura,
    fecha: r.fecha,
    cantidad: Number(r.cantidad ?? 0),
    valor: Number(r.valor ?? 0),
  }));
}

async function obtenerMovimientoInsumos(
  codigoPrestador: string,
  codigoTarifa: string,
  vigencia: { fechaInicio: string; fechaTerminacion: string } | null
): Promise<FilaCrudaFactura[]> {
  // El código real del insumo viene en `codigo_servicio`, NUNCA en
  // `codigo_tarifario` (siempre NULL — mismo hallazgo ya documentado en
  // Módulo 4, obtenerConsumoInsumos).
  const params: unknown[] = [codigoPrestador, codigoTarifa];
  const filtroFecha = vigencia ? construirFiltroFecha("fecha_atencion", vigencia, params) : "";
  const sql = `
    ${CTE_FACTURAS_CANONICAS}
    SELECT rips_at.numero_factura AS numero_factura, fecha_atencion AS fecha, SUM(cantidad) AS cantidad, SUM(valor_total_material) AS valor
    FROM administrativo.rips_at
    ${joinFacturaCanonica("rips_at")}
    WHERE codigo_servicio = $2
      AND consecutivo_rips = ANY(${SUBQUERY_FACTURAS_PRESTADOR})
      ${filtroFecha}
    GROUP BY rips_at.numero_factura, fecha_atencion
  `;
  const result = await pool.query(sql, params, `${SOURCE}/movimiento-insumos`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    numeroFactura: r.numero_factura,
    fecha: r.fecha,
    cantidad: Number(r.cantidad ?? 0),
    valor: Number(r.valor ?? 0),
  }));
}

/** Agrega `AND columna BETWEEN $n AND $n+1` y empuja los 2 parámetros de fecha al array `params` (mutado in-place) — evita repetir el manejo de índices de parámetros en las 3 funciones de arriba. */
function construirFiltroFecha(columna: string, vigencia: { fechaInicio: string; fechaTerminacion: string }, params: unknown[]): string {
  params.push(vigencia.fechaInicio, vigencia.fechaTerminacion);
  const idxInicio = params.length - 1;
  const idxFin = params.length;
  return `AND ${columna} BETWEEN $${idxInicio} AND $${idxFin}`;
}

export async function getMovimientoRipsCodigo(
  ips: number,
  codigoTarifa: string,
  tipo: TipoComparativo
): Promise<ResultadoMovimientoRips> {
  const infoResult = await pool.query(
    `SELECT codigo_prestador, razon_social FROM administrativo.ct_ips WHERE ips = $1 LIMIT 1`,
    [ips],
    `${SOURCE}/info-prestador`
  );
  const info = infoResult?.rows?.[0];
  const codigoPrestador = info?.codigo_prestador ?? null;
  const razonSocial = info?.razon_social ?? "Prestador";

  if (!codigoPrestador) {
    return { ips, codigoPrestador: "", razonSocial, codigoTarifa, tipo, totalCantidad: 0, totalValor: 0, totalFacturas: 0, facturas: [] };
  }

  // Pedido del usuario 2026-07-29: acotar las facturas a la vigencia del
  // contrato (hoy = 2026), no a todo el histórico. Si el prestador no tiene
  // contrato vigente HOY (caso borde: contrato vencido/no vigente), se deja
  // sin filtro de fecha para no ocultar información — mejor mostrar todo el
  // histórico que mostrar "0 movimientos" por un prestador sin vigencia activa.
  const vigencia = await obtenerVigenciaContrato(ips);

  const crudas =
    tipo === "servicios"
      ? await obtenerMovimientoServicios(codigoPrestador, codigoTarifa, vigencia)
      : tipo === "medicamentos"
        ? await obtenerMovimientoMedicamentos(codigoPrestador, codigoTarifa, vigencia)
        : await obtenerMovimientoInsumos(codigoPrestador, codigoTarifa, vigencia);

  const todas: FilaFacturaMovimientoRips[] = crudas
    .map((f) => ({ numeroFactura: f.numeroFactura, fecha: f.fecha, cantidad: f.cantidad, valor: f.valor }))
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));

  // Los totales (cantidad/valor) se calculan sobre TODAS las facturas, no
  // solo las que se muestran — un código de alto volumen (ej. consulta
  // externa) puede tener cientos/miles de facturas históricas; se acota la
  // LISTA mostrada a las más recientes para no renderizar una tabla enorme,
  // pero el total sigue siendo el real (mismo criterio de "acotar el
  // payload, no el número" ya usado en TOP_ENTRADAS_POR_NIVEL/TOP_SOBRECOSTOS_POR_PRESTADOR).
  const totalCantidad = todas.reduce((acc, f) => acc + f.cantidad, 0);
  const totalValor = todas.reduce((acc, f) => acc + f.valor, 0);
  const facturas = todas.slice(0, LIMITE_FACTURAS_MOSTRADAS);

  return {
    ips,
    codigoPrestador,
    razonSocial,
    codigoTarifa,
    tipo,
    totalCantidad,
    totalValor,
    totalFacturas: todas.length,
    facturas,
  };
}
