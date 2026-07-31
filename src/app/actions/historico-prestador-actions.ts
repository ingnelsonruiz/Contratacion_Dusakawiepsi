"use server";

/**
 * Server Actions del módulo — Comparativo Histórico del Prestador.
 *
 * Fuente de datos, SOLO LECTURA, ambas en la MISMA BD (base_sie_dusakawi,
 * esquema administrativo) vía el mismo proxy que el resto del proyecto — ver
 * src/lib/db.ts:
 *   - "2025" (foto histórica): administrativo.historico_tarifas_2025. Tabla
 *     ya existente, compartida con Proyecto_Dusakawi (fue poblada ahí desde
 *     un archivo Excel local, no desde Google Sheets como se pensó
 *     inicialmente — verificado 2026-07-28: 308.228 filas, 111 prestadores,
 *     145 contratos, una sola carga el 2026-05-19). Se consulta en vivo, sin
 *     duplicar la tabla ni depender de Sheets.
 *   - "Vigente": ct_ips_contrato + tb_tarifario_propio_detalle, exactamente
 *     la misma resolución de valor final (resolverValorFinal) y los mismos
 *     filtros de vigencia/exclusión que Módulos 1 y 2.
 *
 * Decisión de alcance (usuario, 2026-07-28): comparación de 2 PUNTOS (2025 vs
 * Vigente), no una serie temporal real multi-año — no existe ese dato todavía.
 * Ver KnowledgeBase/05-ReglasNegocio/Contratación.md para el detalle completo
 * de esta decisión y sus alternativas descartadas.
 */

import { pool } from "@/lib/db";
import { resolverValorFinal } from "@/lib/negociacion/formato";
import { dedupMejorPrecio } from "@/lib/negociacion/comparativo";
import { construirFilaHistorico, calcularKpisHistoricoPrestador } from "@/lib/negociacion/historico-prestador";
import { CONTRATOS_EXCLUIDOS_MIGRACION, CONFIG_TIPO_TARIFARIO } from "@/lib/negociacion/constantes";
import type {
  OpcionPrestadorHistorico,
  ResultadoHistoricoPrestador,
  TipoTarifaHistorico,
} from "@/types/historico-prestador";
import type { UmbralesSemaforo } from "@/types/comparativo";

const SOURCE = "historico-prestador";

// -----------------------------------------------------------------------
// Selector de prestador — lista completa (111 prestadores, no necesita
// paginación) para que la UI filtre/busque en cliente por nombre/NIT, igual
// que getOpcionesMunicipios() en el Módulo 2.
// -----------------------------------------------------------------------

export async function getOpcionesPrestadoresHistorico(): Promise<OpcionPrestadorHistorico[]> {
  const sql = `
    SELECT
      h.nit,
      MAX(h.razon_social) AS razon_social,
      COUNT(DISTINCT h.numero_contrato) AS cantidad_contratos,
      COUNT(DISTINCT h.codigo_tarifa) AS cantidad_codigos
    FROM administrativo.historico_tarifas_2025 h
    GROUP BY h.nit
    ORDER BY MAX(h.razon_social) ASC
  `;
  const result = await pool.query(sql, [], `${SOURCE}/opciones-prestador`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    nit: r.nit,
    razonSocial: r.razon_social,
    cantidadContratosHistoricos: Number(r.cantidad_contratos),
    cantidadCodigosHistoricos: Number(r.cantidad_codigos),
  }));
}

// -----------------------------------------------------------------------
// Histórico completo de un prestador: 2025 vs Vigente, por código.
// -----------------------------------------------------------------------

interface FilaParaDedup {
  ips: number;
  codigoTarifa: string;
  valorFinal: number;
  /** Se transporta a través de dedupMejorPrecio (que preserva el resto de campos de T) para poder mostrar en la UI de qué contrato salió el precio ganador. */
  numeroContrato: string;
}

interface ValorConContrato {
  valor: number;
  numeroContrato: string | null;
}

/** Trae la foto "2025" del prestador, deduplicada por mejor precio (mismo criterio que Módulo 2 — ver dedupMejorPrecio). */
async function obtenerHistorico2025(
  nit: string
): Promise<{ valores: Map<string, ValorConContrato>; descripciones: Map<string, string> }> {
  const sql = `
    SELECT codigo_tarifa, descripcion, valor, numero_contrato
    FROM administrativo.historico_tarifas_2025
    WHERE nit = $1
  `;
  const result = await pool.query(sql, [nit], `${SOURCE}/historico-2025`);
  const rows: any[] = result?.rows ?? [];

  const descripciones = new Map<string, string>();
  const crudas: FilaParaDedup[] = [];
  for (const r of rows) {
    const valor = Number(r.valor ?? 0);
    if (valor > 0) crudas.push({ ips: 0, codigoTarifa: r.codigo_tarifa, valorFinal: valor, numeroContrato: r.numero_contrato });
    if (!descripciones.has(r.codigo_tarifa)) descripciones.set(r.codigo_tarifa, r.descripcion ?? r.codigo_tarifa);
  }

  const deduplicadas = dedupMejorPrecio(crudas);
  const valores = new Map(deduplicadas.map((f) => [f.codigoTarifa, { valor: f.valorFinal, numeroContrato: f.numeroContrato }]));
  return { valores, descripciones };
}

/** Trae el tarifario VIGENTE hoy del prestador (mismos filtros que Módulos 1/2), a través de sus 3 tipos de tarifario. */
async function obtenerVigente(ips: number): Promise<Map<string, ValorConContrato>> {
  const tipos: (keyof typeof CONFIG_TIPO_TARIFARIO)[] = ["servicios", "medicamentos", "insumos"];
  const crudas: FilaParaDedup[] = [];

  for (const tipo of tipos) {
    const cfg = CONFIG_TIPO_TARIFARIO[tipo];
    const sql = `
      SELECT d.codigo_tarifa, d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.porcentaje_tarifa, c.numero_contrato
      FROM administrativo.ct_ips_contrato c
      JOIN administrativo.tb_tarifario_propio_detalle d ON d.consecutivo_tarifa = c.${cfg.columnaTarifario}
      WHERE c.ips = $2
        AND c.sw_activo = 1
        AND c.fecha_anula IS NULL
        AND c.numero_contrato != ALL($1)
        AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
        AND COALESCE(d.sw_paquete, 0) = 0
        AND COALESCE(d.sw_activo, 1) = 1
    `;
    const result = await pool.query(sql, [CONTRATOS_EXCLUIDOS_MIGRACION, ips], `${SOURCE}/vigente-${tipo}`);
    const rows: any[] = result?.rows ?? [];
    for (const r of rows) {
      const valor = Number(r.valor ?? r.valor_servicio ?? 0);
      const valorBase = Number(r.valor_base ?? 0);
      const valorPactado = Number(r.valor_pactado ?? 0);
      const porcentajeTarifa = Number(r.porcentaje_tarifa ?? 0);
      const valorFinal = resolverValorFinal({ valor, valorBase, valorPactado, porcentajeTarifa });
      // Igual que en construirGruposMunicipio (comparativo-actions.ts): un
      // valorFinal <= 0 es un ítem de contrato capitado sin tarifa por
      // evento, no un precio real comparable.
      if (valorFinal > 0) crudas.push({ ips: 0, codigoTarifa: r.codigo_tarifa, valorFinal, numeroContrato: r.numero_contrato });
    }
  }

  const deduplicadas = dedupMejorPrecio(crudas);
  return new Map(deduplicadas.map((f) => [f.codigoTarifa, { valor: f.valorFinal, numeroContrato: f.numeroContrato }]));
}

/**
 * Clasifica un conjunto de códigos (tipo + descripción canónica) cruzando
 * contra los 3 maestros — mismo hallazgo de Módulo 1: el cruce SIEMPRE es
 * por código (`codigo_tarifa` = `<maestro>.codigo_interno`), nunca por FK.
 * Prioridad si un código calzara en más de un maestro (no debería pasar en
 * la práctica): servicios > medicamentos > insumos > otros.
 *
 * Exportada (2026-07-31) para que analisis-propuesta-actions.ts la reutilice
 * tal cual — mismo criterio de reuso ya establecido con
 * `construirGruposTodosMunicipios` (dashboard-riesgo-actions.ts, reutilizada
 * por perfil-prestador-actions.ts): no se duplica la clasificación de
 * códigos en un tercer lugar.
 */
export async function clasificarCodigos(codigos: string[]): Promise<Map<string, { tipo: TipoTarifaHistorico; descripcion: string | null }>> {
  const resultado = new Map<string, { tipo: TipoTarifaHistorico; descripcion: string | null }>();
  if (codigos.length === 0) return resultado;

  const sql = `
    SELECT
      cod.codigo_tarifa,
      CASE
        WHEN cup.codigo_interno IS NOT NULL THEN 'servicios'
        WHEN med.codigo_interno IS NOT NULL THEN 'medicamentos'
        WHEN ins.codigo_interno IS NOT NULL THEN 'insumos'
        ELSE 'otros'
      END AS tipo,
      COALESCE(cup.descripcion, med.descripcion, ins.descripcion) AS descripcion_maestro
    FROM UNNEST($1::text[]) AS cod(codigo_tarifa)
    LEFT JOIN administrativo.tb_cup cup ON cup.codigo_interno = cod.codigo_tarifa
    LEFT JOIN administrativo.tb_medicamento med ON med.codigo_interno = cod.codigo_tarifa
    LEFT JOIN administrativo.tb_insumo ins ON ins.codigo_interno = cod.codigo_tarifa
  `;
  const result = await pool.query(sql, [codigos], `${SOURCE}/clasificar-codigos`);
  const rows: any[] = result?.rows ?? [];
  for (const r of rows) {
    resultado.set(r.codigo_tarifa, { tipo: r.tipo as TipoTarifaHistorico, descripcion: r.descripcion_maestro ?? null });
  }
  return resultado;
}

export async function getHistoricoPrestador(nit: string, umbrales: UmbralesSemaforo): Promise<ResultadoHistoricoPrestador | null> {
  const sqlIps = `SELECT ips, razon_social FROM administrativo.ct_ips WHERE nit = $1 LIMIT 1`;
  const resultIps = await pool.query(sqlIps, [nit], `${SOURCE}/ips-por-nit`);
  const ipsRow = resultIps?.rows?.[0];

  const { valores: valores2025, descripciones: descripcionesHistorico } = await obtenerHistorico2025(nit);

  // Si el NIT no tiene un `ips` activo hoy en ct_ips (caso borde, no
  // observado en los 111 prestadores verificados 2026-07-28, pero posible si
  // se retira un prestador de la red), el comparativo igual se arma —
  // simplemente todo sale como "Eliminado" (solo 2025, sin vigente).
  const valoresVigente = ipsRow ? await obtenerVigente(Number(ipsRow.ips)) : new Map<string, ValorConContrato>();

  const todosLosCodigos = Array.from(new Set([...valores2025.keys(), ...valoresVigente.keys()]));
  const clasificacion = await clasificarCodigos(todosLosCodigos);

  const filas = todosLosCodigos.map((codigo) => {
    const clasif = clasificacion.get(codigo);
    const descripcion = clasif?.descripcion ?? descripcionesHistorico.get(codigo) ?? codigo;
    const tipo: TipoTarifaHistorico = clasif?.tipo ?? "otros";
    const entrada2025 = valores2025.get(codigo) ?? null;
    const entradaVigente = valoresVigente.get(codigo) ?? null;
    return construirFilaHistorico(
      codigo,
      descripcion,
      tipo,
      entrada2025?.valor ?? null,
      entradaVigente?.valor ?? null,
      umbrales,
      entrada2025?.numeroContrato ?? null,
      entradaVigente?.numeroContrato ?? null
    );
  });

  // Mayores variaciones (en cualquier dirección) primero — es lo que más le
  // interesa revisar a un analista antes de negociar. Los que no tienen
  // ambos valores (nuevos/eliminados) van al final.
  filas.sort((a, b) => {
    const va = a.variacionPct === null ? -1 : Math.abs(a.variacionPct);
    const vb = b.variacionPct === null ? -1 : Math.abs(b.variacionPct);
    return vb - va;
  });

  const kpis = calcularKpisHistoricoPrestador(filas);
  const razonSocial = ipsRow?.razon_social ?? (await obtenerRazonSocialHistorico(nit));

  return {
    nit,
    razonSocial,
    filas,
    kpis,
  };
}

/** Fallback de razón social cuando el NIT no tiene fila activa en ct_ips — se usa la registrada en la propia foto histórica. */
async function obtenerRazonSocialHistorico(nit: string): Promise<string> {
  const result = await pool.query(
    `SELECT razon_social FROM administrativo.historico_tarifas_2025 WHERE nit = $1 LIMIT 1`,
    [nit],
    `${SOURCE}/razon-social-fallback`
  );
  return result?.rows?.[0]?.razon_social ?? nit;
}
