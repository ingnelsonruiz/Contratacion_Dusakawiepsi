/**
 * Tipos del Módulo 2 — Comparativo entre Prestadores.
 *
 * Objetivo de negocio (pedido del usuario 2026-07-28): las tarifas varían
 * legítimamente porque los prestadores están en distintos departamentos/
 * municipios (el valor de un CUPS/CUM/insumo se negocia distinto según la
 * ubicación donde se ofertó el contrato). Comparar tarifas de prestadores en
 * municipios distintos mezcla dos efectos (ubicación + negociación real) y no
 * sirve para detectar variabilidad genuina. Por eso este módulo compara
 * SIEMPRE dentro de un mismo municipio: mismo código, mismo municipio,
 * distintos prestadores.
 *
 * Fuente de datos: BD real de ARYUWIS, solo lectura, en vivo (mismo patrón
 * del Módulo 1 — sin ETL, sin snapshot). Reutiliza el hallazgo de Módulo 1 de
 * que las FKs consecutivo_cup/consecutivo_medicamento/consecutivo_insumo NO
 * son confiables — el cruce siempre es por código (d.codigo_tarifa contra
 * <maestro>.codigo_interno).
 */

/** Solo los 3 tipos de tarifario pedidos explícitamente para este módulo (no incluye Otros ni Paquetes). */
export type TipoComparativo = "servicios" | "medicamentos" | "insumos";

/** Umbrales del semáforo de variación porcentual — configurables, NUNCA hardcodeados en la UI final. */
export interface UmbralesSemaforo {
  alertaPct: number; // por defecto 1
  criticoPct: number; // por defecto 10
}

export const UMBRALES_SEMAFORO_DEFECTO: UmbralesSemaforo = {
  alertaPct: 1,
  criticoPct: 10,
};

/**
 * Niveles del semáforo — con DIRECCIÓN, no solo magnitud.
 *
 * Corrección 2026-07-28 (reportada por el usuario con un caso real: un
 * prestador 28% MÁS BARATO que la mediana salía en rojo "Crítico", igual
 * color/urgencia que otro prestador 1.452% MÁS CARO — confundía "esto te
 * está costando de más" con "esto te está costando de menos", cuando desde
 * el punto de vista de Dusakawi como pagador son cosas opuestas: un
 * prestador mucho más barato NO es un riesgo a vigilar de la misma forma
 * que uno mucho más caro).
 *
 * - "alerta"/"critico": el prestador cobra MÁS que la referencia — esto sí
 *   es lo que interesa vigilar para negociación (sobrecosto).
 * - "favorable"/"muyFavorable": el prestador cobra MENOS que la referencia
 *   — se resalta en un tono distinto (no rojo) porque no es un riesgo, es
 *   una oportunidad/dato a revisar con otro criterio.
 * - "ok": dentro del umbral de alerta en cualquier dirección.
 */
export type NivelSemaforo = "ok" | "alerta" | "critico" | "favorable" | "muyFavorable";

/** Referencia contra la que se mide la variación de cada prestador — el usuario elige en la UI, sin recargar datos. */
export type ReferenciaVariacion = "promedio" | "mediana";

/** Municipio disponible para comparar — ya filtrado a los que tienen >= 2 prestadores vigentes con ese tipo de tarifario. */
export interface OpcionMunicipio {
  municipioCodigo: string;
  municipioNombre: string;
  departamentoCodigo: string;
  departamentoNombre: string;
  cantidadPrestadores: number;
}

/**
 * Valor de un prestador puntual para un código, dentro de un municipio.
 *
 * Se calculan las DOS variaciones (vs. promedio y vs. mediana) desde el
 * servidor, para que el usuario pueda alternar la referencia en la UI sin
 * volver a consultar la base de datos — mismo principio que los umbrales del
 * semáforo (ver UmbralesSemaforo).
 */
export interface PrestadorValorComparativo {
  ips: number;
  razonSocial: string;
  nit: string;
  numeroContrato: string;
  consecutivoContrato: number;
  valorFinal: number;
  variacionPctPromedio: number;
  variacionPctMediana: number;
}

/** Fila comparativa: un código (CUPS/CUM/insumo), con la lista de prestadores que lo tienen en un municipio dado. */
export interface FilaComparativoCodigo {
  codigoTarifa: string;
  descripcion: string;
  municipioCodigo: string;
  municipioNombre: string;
  departamentoNombre: string;
  cantidadPrestadores: number;
  minimo: number;
  maximo: number;
  promedio: number;
  mediana: number;
  amplitudPct: number; // (máximo - mínimo) / promedio * 100 — variabilidad genuina del grupo
  prestadores: PrestadorValorComparativo[];
}

export interface ParametrosComparativoMunicipio {
  busqueda?: string;
  page: number;
  pageSize: number;
  /**
   * Umbrales y referencia usados para clasificar el semáforo — se pasan al
   * servidor para poder FILTRAR por estado (`estadosFiltro`) ANTES de
   * paginar (si el filtro se aplicara solo en la página ya traída, se
   * perderían coincidencias en el resto de códigos del municipio).
   */
  umbrales: UmbralesSemaforo;
  referencia: ReferenciaVariacion;
  /** Si viene con al menos un estado, solo se devuelven códigos con >= 1 prestador en alguno de esos estados. */
  estadosFiltro?: NivelSemaforo[];
}

export interface ResultadoPaginadoComparativo<T> {
  filas: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}
