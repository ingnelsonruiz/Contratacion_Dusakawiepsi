/**
 * Tipos de "Perfil Competitivo del Prestador" — nueva tarjeta/módulo
 * independiente del dashboard principal (pedida por el usuario 2026-07-29:
 * "necesito una tarjeta aparte... que analice un prestador en sí contra
 * prestadores del mismo municipio... que se pueda realizar análisis sobre un
 * solo prestador").
 *
 * Complementa a "Comparativo Histórico del Prestador" (Módulo 3, dimensión
 * TEMPORAL: cómo cambió la tarifa de ESTE prestador entre 2025 y hoy) con la
 * dimensión de PARES: cómo se compara ESTE prestador HOY contra los demás
 * prestadores del mismo municipio, para cada código.
 *
 * No es una fuente de datos nueva: reutiliza EXACTAMENTE la misma consulta
 * cruzada de todos los municipios que ya usa el Dashboard Analítico de Riesgo
 * (construirGruposTodosMunicipios en dashboard-riesgo-actions.ts) y la misma
 * agregación por prestador (construirDashboardRiesgo) — solo extrae y expone
 * el resultado de UN prestador específico, sin recortar sus códigos a un Top N
 * (a diferencia de FilaRankingRiesgo.detalleSobrecostos, que sí se acota
 * porque ahí conviven TODOS los prestadores a la vez).
 */

import type { NivelSemaforo, TipoComparativo } from "@/types/comparativo";
import type { FilaRankingRiesgo } from "@/types/dashboard-riesgo";

/**
 * Un prestador dentro del grupo (código+municipio) que se está comparando —
 * incluye a ESTE prestador también (marcado con `esEstePrestador`), para que
 * el acordeón de cada fila pueda mostrar el grupo completo, no solo "contra
 * quién más". Agregado 2026-07-29 a pedido del usuario: "coloca un acordeón
 * en cada código para ver los otros prestadores con los que se compara".
 */
export interface PrestadorGrupoPerfil {
  ips: number;
  razonSocial: string;
  nit: string;
  valorFinal: number;
  esEstePrestador: boolean;
  /**
   * Número de contrato (visible en ARYUWIS) del que sale este valor —
   * agregado 2026-07-29 a pedido del usuario: "para ubicar rápidamente su
   * número de contrato", tanto del prestador analizado como de cada
   * prestador con el que se compara.
   */
  numeroContrato: string;
}

/** Una fila código-a-código del perfil: el valor de ESTE prestador vs. las estadísticas del grupo completo (que lo incluye a él) en ese municipio. */
export interface FilaCodigoPerfil {
  codigoTarifa: string;
  descripcion: string;
  municipioNombre: string;
  /** Cuántos prestadores en total tiene ese código en ese municipio (incluyendo a este). */
  cantidadPrestadoresGrupo: number;
  valorPrestador: number;
  /** Número de contrato del que sale `valorPrestador` — null solo si por alguna razón no se encontró la fila del prestador dentro del grupo (no debería ocurrir en la práctica). */
  numeroContratoPrestador: string | null;
  minimo: number;
  maximo: number;
  promedio: number;
  mediana: number;
  /** Promedio o mediana del grupo, según la referencia elegida en pantalla — mismo valor usado para calcular variacionPct. */
  valorReferencia: number;
  variacionPct: number;
  nivel: NivelSemaforo;
  /** Grupo completo (todos los prestadores de ese código en ese municipio, incluyendo a este), ordenado por valor ascendente — fuente del acordeón. */
  prestadoresGrupo: PrestadorGrupoPerfil[];
}

export interface ResultadoPerfilPrestador {
  tipo: TipoComparativo;
  ips: number;
  razonSocial: string;
  nit: string;
  /**
   * Resumen ejecutivo — la misma fila que este prestador tendría en el
   * ranking del Dashboard Analítico de Riesgo (score, % crítico/alerta,
   * costo potencial adicional, municipios donde opera, etc.). `null` si el
   * prestador no tiene ningún código con 2+ prestadores en el mismo
   * municipio (sin comparación real posible — ej. único contratista en todos
   * sus municipios para este tipo de tarifario).
   */
  resumen: FilaRankingRiesgo | null;
  /** Posición en el ranking de riesgo global (1 = mayor costoPotencialAdicional) — 0 si `resumen` es null. */
  posicionRanking: number;
  totalPrestadoresRanking: number;
  /**
   * Ranking COMPLETO de todos los prestadores de este tipo de tarifario (no
   * solo el de este prestador) — fuente del modal de doble clic sobre
   * "Posición en el ranking" (pedido del usuario 2026-07-29: "que yo pueda
   * darle doble clic y ver el ranking"). Mismos datos que ya calcula el
   * Dashboard Analítico de Riesgo, reutilizados tal cual.
   */
  rankingCompleto: FilaRankingRiesgo[];
  /** TODOS los códigos comparables de este prestador (sin acotar) — ordenados por |variación %| descendente. */
  codigos: FilaCodigoPerfil[];
}
