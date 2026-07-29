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
 * con el usuario 2026-07-28): un MES específico a la vez, un prestador a la
 * vez, solo Servicios+Medicamentos+Insumos (no Consultas/Hospitalizaciones
 * en este MVP) — ver KnowledgeBase/05-ReglasNegocio/Contratación.md.
 */

import { pool } from "@/lib/db";
import { CONTRATOS_EXCLUIDOS_MIGRACION } from "@/lib/negociacion/constantes";
import { construirFilaConsumo, calcularKpisConsumoPrestador } from "@/lib/negociacion/consumo-frecuencia";
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
// Consumo real facturado de un prestador en un mes puntual.
// -----------------------------------------------------------------------

interface FilaCrudaConsumo {
  codigo: string;
  descripcion: string | null;
  cantidad: number;
  valor: number;
}

/** Rango [inicio, fin) del mes elegido — nunca abierto, siempre acotado a 1 mes exacto (regla de rendimiento del módulo). */
function rangoDelMes(mes: number, anio: number): { inicio: string; fin: string } {
  const inicio = new Date(Date.UTC(anio, mes - 1, 1));
  const fin = new Date(Date.UTC(mes === 12 ? anio + 1 : anio, mes === 12 ? 0 : mes, 1));
  return { inicio: inicio.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

/** Facturas (consecutivo_rips) del prestador en el mes elegido — el paso que acota todo lo demás. */
async function obtenerFacturasDelMes(codigoPrestador: string, mes: number, anio: number): Promise<number[]> {
  const { inicio, fin } = rangoDelMes(mes, anio);
  const sql = `
    SELECT consecutivo_rips
    FROM administrativo.rips_af
    WHERE codigo_prestador = $1
      AND fecha_anula IS NULL
      AND fecha_servicio_rips >= $2 AND fecha_servicio_rips < $3
  `;
  const result = await pool.query(sql, [codigoPrestador, inicio, fin], `${SOURCE}/facturas-mes`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => Number(r.consecutivo_rips));
}

async function obtenerConsumoServicios(consecutivosRips: number[]): Promise<FilaCrudaConsumo[]> {
  if (consecutivosRips.length === 0) return [];
  const sql = `
    SELECT ap.codigo_procedimiento AS codigo, cup.descripcion AS descripcion,
      COUNT(*) AS cantidad, SUM(ap.valor_procedimiento) AS valor
    FROM administrativo.rips_ap ap
    LEFT JOIN administrativo.tb_cup cup ON cup.codigo_interno = ap.codigo_procedimiento
    WHERE ap.consecutivo_rips = ANY($1)
    GROUP BY ap.codigo_procedimiento, cup.descripcion
  `;
  const result = await pool.query(sql, [consecutivosRips], `${SOURCE}/consumo-servicios`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad), valor: Number(r.valor ?? 0) }));
}

async function obtenerConsumoMedicamentos(consecutivosRips: number[]): Promise<FilaCrudaConsumo[]> {
  if (consecutivosRips.length === 0) return [];
  const sql = `
    SELECT am.codigo_medicamento AS codigo, COALESCE(med.descripcion, MAX(am.nombre_medicamento)) AS descripcion,
      SUM(am.numero_unidades) AS cantidad, SUM(am.valor_total_medicamento) AS valor
    FROM administrativo.rips_am am
    LEFT JOIN administrativo.tb_medicamento med ON med.codigo_interno = am.codigo_medicamento
    WHERE am.consecutivo_rips = ANY($1)
    GROUP BY am.codigo_medicamento, med.descripcion
  `;
  const result = await pool.query(sql, [consecutivosRips], `${SOURCE}/consumo-medicamentos`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad ?? 0), valor: Number(r.valor ?? 0) }));
}

async function obtenerConsumoInsumos(consecutivosRips: number[]): Promise<FilaCrudaConsumo[]> {
  if (consecutivosRips.length === 0) return [];
  // Corrección 2026-07-28: `rips_at.codigo_tarifario` está SIEMPRE en NULL en
  // toda la tabla (verificado con TABLESAMPLE sobre ~1,2M filas: 0 filas con
  // codigo_tarifario poblado, 100% con codigo_servicio poblado) — el código
  // real del insumo/dispositivo viene en `codigo_servicio`, no en
  // `codigo_tarifario` (nombre engañoso, no corresponde al tarifario
  // contratado). Reportado por el usuario: una fila de insumos salía sin
  // código ni descripción, agregando ~19.303 unidades de golpe.
  const sql = `
    SELECT at2.codigo_servicio AS codigo, ins.descripcion AS descripcion,
      SUM(at2.cantidad) AS cantidad, SUM(at2.valor_total_material) AS valor
    FROM administrativo.rips_at at2
    LEFT JOIN administrativo.tb_insumo ins ON ins.codigo_interno = at2.codigo_servicio
    WHERE at2.consecutivo_rips = ANY($1)
    GROUP BY at2.codigo_servicio, ins.descripcion
  `;
  const result = await pool.query(sql, [consecutivosRips], `${SOURCE}/consumo-insumos`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad ?? 0), valor: Number(r.valor ?? 0) }));
}

export async function getConsumoPrestador(
  codigoPrestador: string,
  mes: number,
  anio: number
): Promise<ResultadoConsumoPrestador | null> {
  const sqlPrestador = `SELECT razon_social FROM administrativo.ct_ips WHERE codigo_prestador = $1 LIMIT 1`;
  const resultPrestador = await pool.query(sqlPrestador, [codigoPrestador], `${SOURCE}/razon-social`);
  const razonSocial = resultPrestador?.rows?.[0]?.razon_social ?? codigoPrestador;

  const consecutivosRips = await obtenerFacturasDelMes(codigoPrestador, mes, anio);

  if (consecutivosRips.length === 0) {
    return {
      codigoPrestador,
      razonSocial,
      mes,
      anio,
      filas: [],
      kpis: calcularKpisConsumoPrestador([], 0),
    };
  }

  const [servicios, medicamentos, insumos] = await Promise.all([
    obtenerConsumoServicios(consecutivosRips),
    obtenerConsumoMedicamentos(consecutivosRips),
    obtenerConsumoInsumos(consecutivosRips),
  ]);

  const filas: FilaConsumoCodigo[] = [
    ...servicios.map((f) => construirFilaConsumo(f.codigo, f.descripcion ?? f.codigo, "servicios" as TipoConsumo, f.cantidad, f.valor)),
    ...medicamentos.map((f) => construirFilaConsumo(f.codigo, f.descripcion ?? f.codigo, "medicamentos" as TipoConsumo, f.cantidad, f.valor)),
    ...insumos.map((f) => construirFilaConsumo(f.codigo, f.descripcion ?? f.codigo, "insumos" as TipoConsumo, f.cantidad, f.valor)),
  ];

  // Mayor valor facturado primero — la vista más útil para identificar en
  // qué se está concentrando el consumo real del prestador en el mes.
  filas.sort((a, b) => b.valorTotal - a.valorTotal);

  const kpis = calcularKpisConsumoPrestador(filas, consecutivosRips.length);

  return { codigoPrestador, razonSocial, mes, anio, filas, kpis };
}
