/**
 * Tipos del Dashboard Analítico de Competitividad y Riesgo Contractual —
 * nueva pestaña del Módulo 2 (Comparativo entre Prestadores), pedida por el
 * usuario 2026-07-29 como herramienta de auditoría para Gerencia/Contratación.
 *
 * Fase A (única implementada por ahora, decidido con el usuario vía
 * AskUserQuestion): KPIs ejecutivos, ranking de riesgo por prestador, score
 * 0-100, heatmap POR MUNICIPIO (no municipio×prestador — ver nota de
 * negocio en construirGruposTodosMunicipios), Top 20 más críticos, ahorro
 * potencial, narrativa automática. Quedan para fases posteriores: boxplot
 * por procedimiento, detección de outliers IQR/Z-score, indicadores
 * estadísticos avanzados (moda, coeficiente de variación, percentiles).
 *
 * Reutiliza el mismo modelo de datos que src/types/comparativo.ts
 * (FilaComparativoCodigo, PrestadorValorComparativo) — este dashboard es una
 * AGREGACIÓN de esas mismas filas a través de TODOS los municipios, no una
 * fuente de datos nueva.
 */

import type { NivelSemaforo, ReferenciaVariacion, TipoComparativo, UmbralesSemaforo } from "@/types/comparativo";

/** Nivel de riesgo del score 0-100 — ver calcularScoreRiesgo() en dashboard-riesgo.ts para los cortes exactos. */
export type NivelRiesgo = "bajo" | "medio" | "alto" | "muyAlto";

/** Opción de filtro "Tipo de contrato" (ct_ips_contrato.tipo_contrato → tb_tipo_contrato.descripcion) — verificado con datos reales: Capitado/Evento/PGP. */
export interface OpcionTipoContrato {
  tipoContrato: number;
  descripcion: string;
}

/**
 * Opción de filtro "Nivel de complejidad" (ct_ips.nivel_complejidad, smallint 0-3).
 * No hay tabla de catálogo para este campo en la BD — se usa la clasificación
 * estándar del sistema de salud colombiano (0 = sin definir/no aplica).
 */
export interface OpcionNivelComplejidad {
  nivelComplejidad: number;
  etiqueta: string;
}

export interface FiltrosDashboardRiesgo {
  municipioCodigo?: string;
  ips?: number;
  tipoContrato?: number[];
  nivelComplejidad?: number[];
  estadosFiltro?: NivelSemaforo[];
  referencia: ReferenciaVariacion;
  umbrales: UmbralesSemaforo;
}

/** KPIs ejecutivos — sección 1 del pedido. */
export interface KpisDashboardRiesgo {
  totalCodigosComparables: number;
  totalPrestadores: number;
  totalMunicipios: number;
  valorPromedioMercado: number;
  variabilidadPromedio: number; // amplitud % promedio de todos los grupos, según la referencia elegida
  cantidadCritico: number;
  cantidadAlerta: number;
  cantidadOk: number;
  cantidadFavorable: number;
  cantidadMuyFavorable: number;
  totalEntradasClasificadas: number; // total de apariciones prestador+código clasificadas (denominador de los % anteriores)
  pctNegociacionCritica: number;
}

/**
 * Una aparición individual crítica/alerta de un prestador (código+municipio)
 * que aporta al "costo potencial adicional" — se envía al cliente para que
 * el menú emergente de doble clic (ver dashboard-riesgo-tab.tsx) pueda
 * mostrar EXACTAMENTE qué códigos sustentan el número, no solo el total.
 * Acotado a las 25 mayores diferencias por prestador (ver `TOP_SOBRECOSTOS_POR_PRESTADOR`
 * en dashboard-riesgo.ts) para no inflar el payload en prestadores con
 * cientos/miles de códigos críticos.
 */
export interface FilaDetalleSobrecosto {
  codigoTarifa: string;
  descripcion: string;
  municipioNombre: string;
  valorFinal: number;
  valorReferencia: number;
  diferenciaAbsoluta: number;
  diferenciaPct: number;
  nivel: "critico" | "alerta";
}

/** Una fila del ranking de riesgo — sección 2 del pedido. */
export interface FilaRankingRiesgo {
  ips: number;
  razonSocial: string;
  nit: string;
  municipiosDondeOpera: string[];
  totalApariciones: number;
  cantidadCritico: number;
  cantidadAlerta: number;
  cantidadOk: number;
  cantidadFavorable: number;
  cantidadMuyFavorable: number;
  pctCritico: number;
  pctAlerta: number;
  indiceDesviacionMedio: number; // promedio de |variación %| (valor absoluto) sobre todas sus apariciones
  amplitudPromedio: number; // amplitud % promedio de los grupos donde participa este prestador
  costoPotencialAdicional: number; // suma de sobrecostos (valorFinal - referencia) SOLO en apariciones crítico/alerta
  score: number; // 0-100, ver calcularScoreRiesgo()
  nivelRiesgo: NivelRiesgo;
  // Desglose del score — mismos 4 componentes que calcularComponentesRiesgo(),
  // ya calculados en el servidor para que el menú emergente muestre la
  // fórmula con los números reales sin recalcular nada en el cliente.
  componenteCriticas: number;
  componenteAlertas: number;
  componenteDesviacion: number;
  componenteAmplitud: number;
  /** Cantidad TOTAL de apariciones crítico/alerta (puede ser mayor que detalleSobrecostos.length si se acotó). */
  cantidadSobrecostos: number;
  detalleSobrecostos: FilaDetalleSobrecosto[];
}

/** Una fila del heatmap — sección 4 del pedido, redefinido a nivel municipio (ver nota de negocio). */
export interface FilaHeatmapMunicipio {
  municipioCodigo: string;
  municipioNombre: string;
  departamentoNombre: string;
  cantidadCodigos: number;
  cantidadCritico: number;
  amplitudPromedio: number;
  pctCritico: number;
}

/** Una fila de la distribución de estados por prestador — sección 5. */
export interface FilaDistribucionEstado {
  ips: number;
  razonSocial: string;
  cantidadMuyFavorable: number;
  cantidadFavorable: number;
  cantidadOk: number;
  cantidadAlerta: number;
  cantidadCritico: number;
  total: number;
}

/** Una fila del Top 20 — sección 9 del pedido. */
export interface FilaTopCritico {
  codigoTarifa: string;
  descripcion: string;
  razonSocial: string;
  municipioNombre: string;
  valorFinal: number;
  valorReferencia: number;
  diferenciaAbsoluta: number;
  diferenciaPct: number;
}

/** Ahorro potencial — sección 8 del pedido. */
export interface AhorroPotencial {
  totalGlobal: number;
  porPrestador: { ips: number; razonSocial: string; ahorro: number }[];
  porMunicipio: { municipioCodigo: string; municipioNombre: string; ahorro: number }[];
}

/**
 * Una aparición individual (código+prestador+municipio) ya clasificada —
 * fuente real detrás de los conteos "Tarifas críticas/alerta/OK/favorables/
 * muy favorables" y "% negociación crítica". Se agregó 2026-07-29 porque el
 * usuario pidió explícitamente que el doble clic lleve al DATO real (qué
 * procedimientos/valores generan el KPI), no solo a la fórmula/descripción.
 */
export interface FilaEntradaDetalle {
  codigoTarifa: string;
  descripcion: string;
  razonSocial: string;
  municipioNombre: string;
  valorFinal: number;
  valorReferencia: number;
  diferenciaAbsoluta: number;
  diferenciaPct: number;
  nivel: NivelSemaforo;
}

/**
 * Un grupo (municipio + código) tal como se usó para calcular "Códigos
 * comparables", "Valor promedio de mercado" y "Variabilidad promedio" — la
 * fuente real detrás de esos 3 KPIs.
 */
export interface FilaDetalleGrupo {
  codigoTarifa: string;
  descripcion: string;
  municipioNombre: string;
  cantidadPrestadores: number;
  minimo: number;
  maximo: number;
  promedio: number;
  mediana: number;
  amplitud: number; // según la referencia elegida en pantalla
}

/** Cuántas filas como máximo se envían al cliente por nivel de semáforo en `detallePorNivel` — ver TOP_ENTRADAS_POR_NIVEL en dashboard-riesgo.ts. */
export type DetallePorNivel = Record<NivelSemaforo, FilaEntradaDetalle[]>;

export interface ResultadoDashboardRiesgo {
  tipo: TipoComparativo;
  kpis: KpisDashboardRiesgo;
  ranking: FilaRankingRiesgo[];
  heatmap: FilaHeatmapMunicipio[];
  distribucionEstados: FilaDistribucionEstado[];
  top20: FilaTopCritico[];
  ahorro: AhorroPotencial;
  narrativa: string[];
  /** Fuente real detrás de "Tarifas críticas/alerta/OK/favorables/muy favorables" y "% negociación crítica" — acotado, ver DetallePorNivel. */
  detallePorNivel: DetallePorNivel;
  /** Fuente real detrás de "Códigos comparables", "Valor promedio de mercado" y "Variabilidad promedio" — sin acotar (mismo tamaño ya calculado en `grupos`). */
  detalleGrupos: FilaDetalleGrupo[];
}
