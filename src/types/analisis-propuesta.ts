/**
 * Tipos del módulo "Análisis de Propuesta del Prestador" — nueva tarjeta del
 * dashboard (pedida por el usuario 2026-07-31), en la misma línea de los
 * módulos ad-hoc ya construidos sobre la infraestructura del Módulo 2
 * (Comparativo entre Prestadores): Perfil Competitivo del Prestador, Top
 * Impacto Económico, etc. — ninguno de ellos estaba en los 8 módulos
 * originales de docs/ARQUITECTURA.md, todos reutilizan la misma base de
 * comparación "dentro de un mismo municipio" ya validada.
 *
 * Objetivo de negocio: un prestador nuevo (o uno vigente renegociando) envía
 * una propuesta de tarifas — un listado de códigos (CUPS/CUM/insumo) con el
 * precio que ofrece. El analista de Contratación necesita, ANTES de aceptar
 * o contrapropuestar, saber cómo se compara cada código ofertado contra lo
 * que YA se paga en ese municipio a otros prestadores: la mediana/promedio
 * real del mercado local, quién más lo presta, y cuáles son las ofertas más
 * favorables vigentes (con su contrato) para poder citarlas en la
 * negociación.
 *
 * Fuente de datos: 100% solo lectura, en vivo, contra la misma BD de ARYUWIS
 * que el resto del proyecto (ct_ips_contrato + tb_tarifario_propio_detalle +
 * tb_cup/tb_medicamento/tb_insumo). El archivo que sube el usuario NUNCA se
 * persiste — se parsea en memoria, se evalúa contra el tarifario vigente del
 * municipio elegido y el resultado se puede exportar, pero no se guarda
 * ningún escenario en la BD (a diferencia del Módulo 5 — Simulador de
 * Escenarios, planificado con tablas propias — este módulo es de
 * evaluación puntual, no de seguimiento de rondas de negociación).
 */

import type { NivelSemaforo, ReferenciaVariacion, TipoComparativo, UmbralesSemaforo } from "@/types/comparativo";
import type { ReferenciaMercadoEps } from "@/types/precio-referencia-eps";

/** Un código puede no cruzar contra ningún maestro (CUPS/CUM/insumo) — se marca aparte, nunca se descarta en silencio. */
export type TipoCodigoPropuesta = TipoComparativo | "noEncontrado";

/** Una fila cruda, tal como se leyó del archivo (CSV/TXT/XLSX), antes de evaluarla contra el mercado. */
export interface FilaPropuestaCargada {
  /** Número de fila del archivo original (2 = primera fila de datos, la 1 es el encabezado) — para que el analista pueda ubicarla si hay un error. */
  filaOriginal: number;
  codigo: string;
  precioOfertado: number;
}

/** Una fila del archivo que no se pudo interpretar — se reporta, nunca se descarta en silencio. */
export interface ErrorFilaPropuesta {
  filaOriginal: number;
  contenido: string;
  motivo: string;
}

/** Un prestador que YA tiene ese código contratado en el municipio elegido — la referencia real de mercado para negociar. */
export interface PrestadorReferenciaPropuesta {
  ips: number;
  razonSocial: string;
  nit: string;
  numeroContrato: string;
  consecutivoContrato: number;
  valorFinal: number;
  /** Más barato que la mediana del grupo — candidato a citar como "ya existe una oferta más favorable" en la negociación. */
  porDebajoDeMediana: boolean;
  /** Más barato que el precio que el prestador está ofertando en el archivo subido. */
  porDebajoDePropuesta: boolean;
}

/** Resultado de evaluar UN código ofertado contra el mercado del municipio elegido. */
export interface FilaEvaluacionPropuesta {
  filaOriginal: number;
  codigo: string;
  descripcion: string;
  tipo: TipoCodigoPropuesta;
  precioOfertado: number;
  cantidadPrestadoresReferencia: number;
  minimo: number | null;
  maximo: number | null;
  promedio: number | null;
  mediana: number | null;
  /** null cuando no hay ningún prestador de referencia en el municipio (nada contra qué comparar). */
  variacionPctPromedio: number | null;
  variacionPctMediana: number | null;
  diferenciaAbsolutaVsMediana: number | null;
  diferenciaAbsolutaVsPromedio: number | null;
  /** "sinReferencia" cuando el código no tiene ningún prestador comparable en ese municipio (código nuevo para la zona, o no clasificable). */
  nivel: NivelSemaforo | "sinReferencia";
  /** Ordenados de menor a mayor valorFinal — el primero es la oferta más favorable ya vigente. */
  prestadoresReferencia: PrestadorReferenciaPropuesta[];
  /**
   * Precios que OTRAS EPS reportaron para este mismo código en este mismo
   * municipio (tabla `negociacion_contratacion_precio_referencia_eps`, ver
   * src/types/precio-referencia-eps.ts) — ordenados de menor a mayor precio.
   * Es una referencia de mercado ADICIONAL a `prestadoresReferencia`
   * (contratos propios de Dusakawi): deliberadamente NO se mezcla en
   * `minimo`/`maximo`/`promedio`/`mediana`/`nivel` (el semáforo compara la
   * oferta contra lo que Dusakawi YA paga en su propia red, no contra lo que
   * pagan aseguradoras terceras, que pueden tener condiciones de contratación
   * distintas) — se muestra y exporta por separado, ver
   * KnowledgeBase/05-ReglasNegocio/Contratación.md.
   */
  referenciasMercadoEps: ReferenciaMercadoEps[];
}

export interface ResumenEvaluacionPropuesta {
  totalCodigos: number;
  totalConReferencia: number;
  totalSinReferencia: number;
  /** ok + favorable + muyFavorable: la propuesta es igual o más barata que el mercado local. */
  totalFavorables: number;
  /** alerta + critico: la propuesta es más cara que el mercado local — punto de negociación. */
  totalCriticos: number;
  /**
   * Suma, solo sobre códigos con referencia, de (precioOfertado - mediana)
   * cuando es positivo (la propuesta pide más que la mediana local).
   *
   * ADVERTENCIA (mismo criterio que el Dashboard de Riesgo del Módulo 2, ver
   * KnowledgeBase/05-ReglasNegocio/Contratación.md): esto es un ahorro
   * potencial POR UNIDAD TARIFADA si se negociara cada código crítico a la
   * mediana, NO un ahorro proyectado por volumen real de consumo (para eso
   * habría que cruzar contra RIPS, que es el Módulo 4 — Consumo y
   * Frecuencia). Se documenta explícitamente en la UI para no sobre-vender
   * el número.
   */
  ahorroPotencialUnitarioVsMediana: number;
}

export interface ParametrosAnalisisPropuesta {
  municipioCodigo: string;
  referencia: ReferenciaVariacion;
  umbrales: UmbralesSemaforo;
}

export interface ResultadoAnalisisPropuesta {
  nombreArchivo: string;
  municipioCodigo: string;
  municipioNombre: string;
  departamentoNombre: string;
  referencia: ReferenciaVariacion;
  umbrales: UmbralesSemaforo;
  filas: FilaEvaluacionPropuesta[];
  erroresParseo: ErrorFilaPropuesta[];
  resumen: ResumenEvaluacionPropuesta;
  fechaAnalisis: string;
}

/** Municipio disponible para evaluar una propuesta — cualquiera con al menos 1 contrato vigente (no exige 2+ prestadores como el Módulo 2, aquí basta 1 referencia para poder comparar). */
export interface OpcionMunicipioPropuesta {
  municipioCodigo: string;
  municipioNombre: string;
  departamentoNombre: string;
  cantidadContratosVigentes: number;
}
