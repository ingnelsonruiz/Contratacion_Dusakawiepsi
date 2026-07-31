"use server";

/**
 * Server Actions del módulo — Consumo y Frecuencia.
 *
 * Fuente de datos: RIPS reales (`rips_af`/`rips_ap`/`rips_am`/`rips_at`),
 * SOLO LECTURA, en vivo. A diferencia de Módulos 1/2/3 (que viven sobre el
 * tarifario contratado, tablas de miles de filas), aquí se consultan tablas
 * de decenas/cientos de millones de filas SIN índice por fecha ni por
 * prestador — verificado 2026-07-28 con `EXPLAIN ANALYZE`:
 *   - rips_af: 10,2M filas — único índice útil aquí es `consecutivo_rips`.
 *     Filtrar por `codigo_prestador` + `fecha_servicio_rips` es un Seq Scan
 *     completo (~6-8s medidos), pero queda muy por debajo del timeout de
 *     90s del proxy (`src/lib/db.ts`).
 *   - rips_ap (171M), rips_am (77M), rips_at (57M): NINGÚN índice por fecha
 *     ni prestador — por eso NUNCA se filtran directamente por esas
 *     columnas. Se filtran por `consecutivo_rips = ANY(...)` (índice real en
 *     las 3), usando la lista YA ACOTADA que sale de filtrar `rips_af`
 *     primero. Ese `IN`/`ANY` resuelve en milisegundos (Index Scan).
 *
 * Por eso el alcance de este módulo está deliberadamente acotado (decisión
 * con el usuario 2026-07-28, ampliada 2026-07-30): un prestador a la vez,
 * solo Servicios+Medicamentos+Insumos (no Consultas/Hospitalizaciones en
 * este MVP), y un RANGO de fechas día-a-día con tope de seguridad de
 * `MAX_DIAS_RANGO_CONSUMO` días (~3 meses, ver validarRangoConsumo() en
 * src/lib/negociacion/consumo-frecuencia.ts) — reemplaza el selector de "un
 * mes específico" original tras pedido del usuario, manteniendo la misma
 * estrategia de consulta (rips_af acota primero, luego Index Scan por
 * consecutivo_rips) y el mismo criterio de nunca dejar el rango abierto —
 * ver KnowledgeBase/05-ReglasNegocio/Contratación.md.
 */

import { pool } from "@/lib/db";
import { CONTRATOS_EXCLUIDOS_MIGRACION } from "@/lib/negociacion/constantes";
import { construirFilaConsumo, calcularKpisConsumoPrestador, validarRangoConsumo } from "@/lib/negociacion/consumo-frecuencia";
import { sqlFacturasCanonicas, joinFacturaCanonica } from "@/lib/negociacion/rips-dedup";
import type { OpcionPrestadorConsumo, ResultadoConsumoPrestador, FilaConsumoCodigo, TipoConsumo } from "@/types/consumo-frecuencia";

const SOURCE = "consumo-frecuencia";

// -----------------------------------------------------------------------
// Selector de prestador — prestadores con >= 1 contrato vigente hoy (mismo
// criterio de vigencia que Módulos 1/2/3).
// -----------------------------------------------------------------------

export async function getOpcionesPrestadoresConsumo(): Promise<OpcionPrestadorConsumo[]> {
  const sql = `
    SELECT DISTINCT ips.ips, ips.codigo_prestador, ips.razon_social, ips.nit
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    WHERE c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND ips.codigo_prestador IS NOT NULL
    ORDER BY ips.razon_social ASC
  `;
  const result = await pool.query(sql, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-prestador`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    ips: Number(r.ips),
    codigoPrestador: r.codigo_prestador,
    razonSocial: r.razon_social,
    nit: r.nit,
  }));
}

// -----------------------------------------------------------------------
// Consumo real facturado de un prestador en un rango de fechas puntual.
// -----------------------------------------------------------------------

interface FilaCrudaConsumo {
  codigo: string;
  descripcion: string | null;
  cantidad: number;
  valor: number;
}

interface FragmentoRango {
  /** `WITH facturas_rango AS MATERIALIZED (...), facturas_canonicas AS MATERIALIZED (...)` — se antepone una vez a cada consulta. */
  cte: string;
  /** Referencia corta al conjunto de `consecutivo_rips` del rango (para el filtro `= ANY(...)`, que sí usa el índice real de las 3 tablas grandes). */
  ref: string;
  params: unknown[];
}

/**
 * Fragmento reutilizado por las 3 consultas de consumo — arma DOS CTEs:
 * `facturas_rango` (igual que antes, el conjunto de `consecutivo_rips` del
 * prestador+rango, para el filtro rápido por índice) y `facturas_canonicas`
 * (agregada 2026-07-30, ver `rips-dedup.ts`) — una factura real puede
 * aparecer repetida en varios lotes/`consecutivo_rips` (recargas de RIPS no
 * limpiadas); sin deduplicar por factura, sus líneas de detalle se cuentan
 * una vez POR LOTE, inflando cantidad y valor (caso real verificado hasta
 * 13x). `facturas_canonicas` elige 1 sola copia por factura antes de agregar.
 */
function construirFragmentoRango(codigoPrestador: string, fechaInicio: string, fechaFin: string): FragmentoRango {
  const condiciones = "codigo_prestador = $1 AND fecha_anula IS NULL AND fecha_servicio_rips >= $2 AND fecha_servicio_rips <= $3";
  const params: unknown[] = [codigoPrestador, fechaInicio, fechaFin];
  return {
    cte: `WITH facturas_rango AS MATERIALIZED (SELECT consecutivo_rips FROM administrativo.rips_af WHERE ${condiciones}), facturas_canonicas AS MATERIALIZED (${sqlFacturasCanonicas(condiciones)})`,
    ref: "ARRAY(SELECT consecutivo_rips FROM facturas_rango)",
    params,
  };
}

/** Cuántas facturas REALES distintas (ya deduplicadas) hay en el rango — reemplaza el conteo crudo de `consecutivo_rips` de antes (que podía incluir varias copias de la misma factura). Se usa tanto para el "no hay datos" temprano como para el KPI de facturas del prestador. */
async function contarFacturasDelRango(fragmento: FragmentoRango): Promise<number> {
  const sql = `${fragmento.cte} SELECT COUNT(*) AS total FROM facturas_canonicas`;
  const result = await pool.query(sql, fragmento.params, `${SOURCE}/conteo-facturas-rango`);
  return Number(result?.rows?.[0]?.total ?? 0);
}

async function obtenerConsumoServicios(fragmento: FragmentoRango): Promise<FilaCrudaConsumo[]> {
  const sql = `
    ${fragmento.cte}
    SELECT ap.codigo_procedimiento AS codigo, cup.descripcion AS descripcion,
      COUNT(*) AS cantidad, SUM(ap.valor_procedimiento) AS valor
    FROM administrativo.rips_ap ap
    ${joinFacturaCanonica("ap")}
    LEFT JOIN administrativo.tb_cup cup ON cup.codigo_interno = ap.codigo_procedimiento
    WHERE ap.consecutivo_rips = ANY(${fragmento.ref})
    GROUP BY ap.codigo_procedimiento, cup.descripcion
  `;
  const result = await pool.query(sql, fragmento.params, `${SOURCE}/consumo-servicios`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad), valor: Number(r.valor ?? 0) }));
}

async function obtenerConsumoMedicamentos(fragmento: FragmentoRango): Promise<FilaCrudaConsumo[]> {
  const sql = `
    ${fragmento.cte}
    SELECT am.codigo_medicamento AS codigo, COALESCE(med.descripcion, MAX(am.nombre_medicamento)) AS descripcion,
      SUM(am.numero_unidades) AS cantidad, SUM(am.valor_total_medicamento) AS valor
    FROM administrativo.rips_am am
    ${joinFacturaCanonica("am")}
    LEFT JOIN administrativo.tb_medicamento med ON med.codigo_interno = am.codigo_medicamento
    WHERE am.consecutivo_rips = ANY(${fragmento.ref})
    GROUP BY am.codigo_medicamento, med.descripcion
  `;
  const result = await pool.query(sql, fragmento.params, `${SOURCE}/consumo-medicamentos`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad ?? 0), valor: Number(r.valor ?? 0) }));
}

async function obtenerConsumoInsumos(fragmento: FragmentoRango): Promise<FilaCrudaConsumo[]> {
  // Corrección 2026-07-28: `rips_at.codigo_tarifario` está SIEMPRE en NULL en
  // toda la tabla (verificado con TABLESAMPLE sobre ~1,2M filas: 0 filas con
  // codigo_tarifario poblado, 100% con codigo_servicio poblado) — el código
  // real del insumo/dispositivo viene en `codigo_servicio`, no en
  // `codigo_tarifario` (nombre engañoso, no corresponde al tarifario
  // contratado). Reportado por el usuario: una fila de insumos salía sin
  // código ni descripción, agregando ~19.303 unidades de golpe.
  //
  // Corrección 2026-07-30: `codigo_servicio` no siempre es un insumo real —
  // códigos de "estancia"/habitación (ej. `108A01` "INTERNACIÓN EN UNIDAD DE
  // CUIDADO INTENSIVO NEONATAL") son códigos CUPS reales que ARYUWIS reporta
  // vía el archivo RIPS de "otros servicios" (`rips_at`) en vez del de
  // procedimientos (`rips_ap`). Verificado EPS-completa: de 8.288 códigos
  // distintos en `rips_at` (2026), 354 (4,3% de los códigos, pero 73% del
  // VALOR) solo resuelven en `tb_cup`, no en `tb_insumo` — sin este respaldo
  // aparecían con el código repetido como descripción. Se agrega
  // `LEFT JOIN tb_cup` como respaldo, mismo criterio ya aplicado en
  // "Análisis de Códigos de Mayor Impacto Económico" (ver
  // KnowledgeBase/05-ReglasNegocio/Contratación.md).
  const sql = `
    ${fragmento.cte}
    SELECT at2.codigo_servicio AS codigo, COALESCE(ins.descripcion, cup.descripcion) AS descripcion,
      SUM(at2.cantidad) AS cantidad, SUM(at2.valor_total_material) AS valor
    FROM administrativo.rips_at at2
    ${joinFacturaCanonica("at2")}
    LEFT JOIN administrativo.tb_insumo ins ON ins.codigo_interno = at2.codigo_servicio
    LEFT JOIN administrativo.tb_cup cup ON cup.codigo_interno = at2.codigo_servicio
    WHERE at2.consecutivo_rips = ANY(${fragmento.ref})
    GROUP BY at2.codigo_servicio, ins.descripcion, cup.descripcion
  `;
  const result = await pool.query(sql, fragmento.params, `${SOURCE}/consumo-insumos`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad ?? 0), valor: Number(r.valor ?? 0) }));
}

export async function getConsumoPrestador(
  codigoPrestador: string,
  fechaInicio: string,
  fechaFin: string
): Promise<ResultadoConsumoPrestador | null> {
  // Defensa en profundidad: el cliente ya valida el rango antes de habilitar
  // "Consultar" (mismo `validarRangoConsumo`, única fuente de verdad), pero
  // el servidor nunca confía en esa validación — por ejemplo si se llama esta
  // Server Action directamente o si la exportación arma la URL a mano.
  const validacion = validarRangoConsumo(fechaInicio, fechaFin);
  if (!validacion.valido) {
    throw new Error(validacion.error ?? "Rango de fechas inválido.");
  }

  const sqlPrestador = `SELECT razon_social FROM administrativo.ct_ips WHERE codigo_prestador = $1 LIMIT 1`;
  const resultPrestador = await pool.query(sqlPrestador, [codigoPrestador], `${SOURCE}/razon-social`);
  const razonSocial = resultPrestador?.rows?.[0]?.razon_social ?? codigoPrestador;

  const fragmento = construirFragmentoRango(codigoPrestador, fechaInicio, fechaFin);
  const totalFacturas = await contarFacturasDelRango(fragmento);

  if (totalFacturas === 0) {
    return {
      codigoPrestador,
      razonSocial,
      fechaInicio,
      fechaFin,
      filas: [],
      kpis: calcularKpisConsumoPrestador([], 0),
    };
  }

  const [servicios, medicamentos, insumos] = await Promise.all([
    obtenerConsumoServicios(fragmento),
    obtenerConsumoMedicamentos(fragmento),
    obtenerConsumoInsumos(fragmento),
  ]);

  const filas: FilaConsumoCodigo[] = [
    ...servicios.map((f) => construirFilaConsumo(f.codigo, f.descripcion ?? f.codigo, "servicios" as TipoConsumo, f.cantidad, f.valor)),
    ...medicamentos.map((f) => construirFilaConsumo(f.codigo, f.descripcion ?? f.codigo, "medicamentos" as TipoConsumo, f.cantidad, f.valor)),
    ...insumos.map((f) => construirFilaConsumo(f.codigo, f.descripcion ?? f.codigo, "insumos" as TipoConsumo, f.cantidad, f.valor)),
  ];

  // Mayor valor facturado primero — la vista más útil para identificar en
  // qué se está concentrando el consumo real del prestador en el rango.
  filas.sort((a, b) => b.valorTotal - a.valorTotal);

  const kpis = calcularKpisConsumoPrestador(filas, totalFacturas);

  return { codigoPrestador, razonSocial, fechaInicio, fechaFin, filas, kpis };
}
