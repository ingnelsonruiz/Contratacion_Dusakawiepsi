/**
 * Tipos del nuevo módulo — Comparativo Histórico del Prestador.
 *
 * Objetivo de negocio (pedido del usuario 2026-07-28): ver la evolución de la
 * tarifa negociada con UN mismo prestador a través del tiempo (procedimientos,
 * medicamentos e insumos), para apoyar al área de Contratación en procesos de
 * renovación/negociación.
 *
 * Decisión de alcance tomada con el usuario (2026-07-28), documentada también
 * en KnowledgeBase/05-ReglasNegocio/Contratación.md:
 *   - Fuente histórica: administrativo.historico_tarifas_2025 (una carga real
 *     ya existente en la BD compartida con Proyecto_Dusakawi — 308.228 filas,
 *     111 prestadores, 145 contratos, cargada 2026-05-19). NO se usa Google
 *     Sheets — esa tabla ya vive en la misma BD (base_sie_dusakawi) que este
 *     proyecto consulta vía el mismo proxy, así que se consulta en vivo igual
 *     que el resto del sistema, sin duplicar datos.
 *   - No existe una serie temporal real multi-año todavía. El comparativo es
 *     de 2 PUNTOS: el valor de esa foto "2025" vs. el valor VIGENTE hoy en
 *     ARYUWIS (mismo cálculo de valor final que Módulos 1 y 2). Si en el
 *     futuro se implementan snapshots periódicos reales (ver
 *     `negociacion_contratacion_snapshot_tarifario` en docs/ARQUITECTURA.md),
 *     este mismo tipo de dato se puede extender a N puntos sin romper la UI
 *     (la tabla y el gráfico ya están pensados para una lista de "puntos").
 *   - MVP: selección de prestador + tabla comparativa + variación % +
 *     gráfico + KPIs básicos. Quedan para una 2ª iteración: ranking Top
 *     20 de incrementos/disminuciones, comparación contrato-contra-contrato
 *     (tarifas nuevas/eliminadas/modificadas) y observaciones automáticas en
 *     texto — ver Pendientes.md.
 *
 * Reutiliza los tipos de semáforo del Módulo 2 (misma semántica: un aumento
 * de tarifa es un riesgo de sobrecosto a vigilar; una disminución es
 * favorable) — ver @/types/comparativo.
 */

import type { NivelSemaforo, UmbralesSemaforo } from "@/types/comparativo";

export type TipoTarifaHistorico = "servicios" | "medicamentos" | "insumos" | "otros";

/** Prestador disponible para consultar histórico — existe en administrativo.historico_tarifas_2025. */
export interface OpcionPrestadorHistorico {
  nit: string;
  razonSocial: string;
  cantidadContratosHistoricos: number;
  cantidadCodigosHistoricos: number;
}

/** Un punto de valor en el tiempo para un código — hoy solo hay 2 ("2025" y "Vigente"), diseñado para soportar más sin cambios de forma. */
export interface PuntoHistorico {
  etiqueta: string; // "2025" | "Vigente" (o el período real, cuando existan snapshots)
  valor: number;
}

/** Comparación de un código puntual entre el histórico 2025 y el valor vigente hoy. */
export interface FilaHistoricoCodigo {
  codigoTarifa: string;
  descripcion: string;
  tipo: TipoTarifaHistorico;
  /** Valor en la foto "2025" (administrativo.historico_tarifas_2025). null si el código no existía en esa carga (es nuevo desde entonces). */
  valor2025: number | null;
  /** Valor final vigente hoy en ARYUWIS (mismo resolverValorFinal() de Módulos 1/2). null si el código ya no está contratado activamente. */
  valorVigente: number | null;
  /** Número de contrato (numero_contrato) que respaldaba este precio en la foto 2025 — null si el código no existía entonces. Pedido por el usuario 2026-07-28 para poder ubicar el contrato exacto en ARYUWIS. */
  contrato2025: string | null;
  /** Número de contrato vigente hoy que respalda este precio — null si el código ya no está contratado activamente. */
  contratoVigente: string | null;
  /** Solo se calcula cuando AMBOS valores existen — no tiene sentido comparar contra null. */
  variacionAbsoluta: number | null;
  variacionPct: number | null;
  nivel: NivelSemaforo | null;
  /** Serie de puntos lista para graficar (omite los que sean null). */
  puntos: PuntoHistorico[];
}

/** KPIs ejecutivos del prestador seleccionado — calculados SOLO sobre códigos presentes en AMBOS lados (comparación real, manzanas con manzanas). */
export interface KpisHistoricoPrestador {
  valorTotal2025: number;
  valorTotalVigente: number;
  incrementoAcumulado: number;
  incrementoAcumuladoPct: number;
  cantidadCodigosComparados: number;
  cantidadAumentaron: number;
  cantidadDisminuyeron: number;
  cantidadSinCambio: number;
  /** Códigos que existen HOY vigentes pero no estaban en la foto 2025 — negociados después. */
  cantidadNuevos: number;
  /** Códigos que estaban en 2025 pero ya no están vigentes hoy (vencidos/retirados del tarifario). */
  cantidadEliminados: number;
}

export interface ParametrosHistoricoPrestador {
  nit: string;
  umbrales: UmbralesSemaforo;
}

export interface ResultadoHistoricoPrestador {
  nit: string;
  razonSocial: string;
  filas: FilaHistoricoCodigo[];
  kpis: KpisHistoricoPrestador;
}
