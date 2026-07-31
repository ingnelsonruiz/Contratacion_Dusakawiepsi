/**
 * Funciones puras del módulo "Análisis de Propuesta del Prestador".
 *
 * Mismo principio de arquitectura que src/lib/negociacion/comparativo.ts:
 * cálculo de negocio en funciones puras, sin dependencias de Next.js/BD,
 * testeables de forma aislada. Reutiliza tal cual `calcularEstadisticas`,
 * `calcularVariacionPct` y `clasificarSemaforo` de comparativo.ts — la
 * semántica del semáforo es la MISMA que en el Módulo 2 (un precio ofertado
 * por ENCIMA de la referencia del municipio es un riesgo de sobrecosto a
 * vigilar; por DEBAJO es favorable para Dusakawi como pagador), solo cambia
 * contra qué se compara: aquí un precio propuesto por un prestador, no el
 * precio ya contratado de otro prestador.
 */

import { calcularEstadisticas, calcularVariacionPct, clasificarSemaforo } from "@/lib/negociacion/comparativo";
import type { NivelSemaforo, ReferenciaVariacion, UmbralesSemaforo } from "@/types/comparativo";
import type {
  FilaEvaluacionPropuesta,
  FilaPropuestaCargada,
  PrestadorReferenciaPropuesta,
  ResumenEvaluacionPropuesta,
  TipoCodigoPropuesta,
} from "@/types/analisis-propuesta";
import type { ReferenciaMercadoEps } from "@/types/precio-referencia-eps";

/** Un prestador ya contratado en el municipio para el código evaluado — la "referencia de mercado" real. */
export interface PrestadorMercadoPropuesta {
  ips: number;
  razonSocial: string;
  nit: string;
  numeroContrato: string;
  consecutivoContrato: number;
  valorFinal: number;
}

/**
 * Evalúa UNA fila del archivo cargado contra los prestadores que YA tienen
 * ese código contratado en el municipio elegido. Si `prestadoresMercado`
 * viene vacío (código sin ningún prestador comparable en ese municipio — ya
 * sea porque es un código nuevo para la zona o porque no se pudo clasificar
 * contra ningún maestro), se devuelve sin estadísticas ni semáforo
 * ("sinReferencia") — nunca se inventa una comparación donde no la hay
 * (mismo criterio que "códigos nuevos/eliminados" en Comparativo Histórico
 * del Prestador, ver KnowledgeBase/05-ReglasNegocio/Contratación.md).
 */
export function construirFilaEvaluacion(
  filaCargada: FilaPropuestaCargada,
  tipo: TipoCodigoPropuesta,
  descripcion: string,
  prestadoresMercado: PrestadorMercadoPropuesta[],
  referencia: ReferenciaVariacion,
  umbrales: UmbralesSemaforo,
  referenciasMercadoEps: ReferenciaMercadoEps[] = []
): FilaEvaluacionPropuesta {
  const base = {
    filaOriginal: filaCargada.filaOriginal,
    codigo: filaCargada.codigo,
    descripcion,
    tipo,
    precioOfertado: filaCargada.precioOfertado,
  };

  // Ordenadas de menor a mayor precio, igual que `prestadoresReferencia` —
  // no se ordenan por nombre de EPS ni se filtran aquí (el filtro "más
  // económico que la oferta" es responsabilidad de cada consumidor: la UI
  // las muestra todas para dar contexto completo, el export de
  // contrapropuesta sí filtra, ver route.ts).
  const referenciasMercadoEpsOrdenadas = [...referenciasMercadoEps].sort((a, b) => a.precio - b.precio);

  if (prestadoresMercado.length === 0) {
    return {
      ...base,
      cantidadPrestadoresReferencia: 0,
      minimo: null,
      maximo: null,
      promedio: null,
      mediana: null,
      variacionPctPromedio: null,
      variacionPctMediana: null,
      diferenciaAbsolutaVsMediana: null,
      diferenciaAbsolutaVsPromedio: null,
      nivel: "sinReferencia",
      prestadoresReferencia: [],
      referenciasMercadoEps: referenciasMercadoEpsOrdenadas,
    };
  }

  const stats = calcularEstadisticas(prestadoresMercado.map((p) => p.valorFinal));
  const variacionPctPromedio = calcularVariacionPct(filaCargada.precioOfertado, stats.promedio);
  const variacionPctMediana = calcularVariacionPct(filaCargada.precioOfertado, stats.mediana);
  const variacionSegunReferencia = referencia === "promedio" ? variacionPctPromedio : variacionPctMediana;
  const nivel: NivelSemaforo = clasificarSemaforo(variacionSegunReferencia, umbrales);

  const prestadoresReferencia: PrestadorReferenciaPropuesta[] = prestadoresMercado
    .map((p) => ({
      ips: p.ips,
      razonSocial: p.razonSocial,
      nit: p.nit,
      numeroContrato: p.numeroContrato,
      consecutivoContrato: p.consecutivoContrato,
      valorFinal: p.valorFinal,
      porDebajoDeMediana: p.valorFinal < stats.mediana,
      porDebajoDePropuesta: p.valorFinal < filaCargada.precioOfertado,
    }))
    .sort((a, b) => a.valorFinal - b.valorFinal);

  return {
    ...base,
    cantidadPrestadoresReferencia: prestadoresMercado.length,
    minimo: stats.minimo,
    maximo: stats.maximo,
    promedio: stats.promedio,
    mediana: stats.mediana,
    variacionPctPromedio,
    variacionPctMediana,
    diferenciaAbsolutaVsMediana: filaCargada.precioOfertado - stats.mediana,
    diferenciaAbsolutaVsPromedio: filaCargada.precioOfertado - stats.promedio,
    nivel,
    prestadoresReferencia,
    referenciasMercadoEps: referenciasMercadoEpsOrdenadas,
  };
}

/**
 * Resumen ejecutivo de la propuesta completa. `ahorroPotencialUnitarioVsMediana`
 * es la suma de (precioOfertado - mediana) solo en los códigos donde eso es
 * positivo (la propuesta pide más que la mediana local) — es un ahorro POR
 * UNIDAD TARIFADA si se negociara cada código a la mediana, no un ahorro
 * proyectado por volumen real de consumo (mismo criterio/advertencia que el
 * Dashboard de Riesgo del Módulo 2, ver src/types/analisis-propuesta.ts).
 */
export function construirResumenEvaluacion(filas: FilaEvaluacionPropuesta[]): ResumenEvaluacionPropuesta {
  let totalSinReferencia = 0;
  let totalFavorables = 0;
  let totalCriticos = 0;
  let ahorroPotencialUnitarioVsMediana = 0;

  for (const fila of filas) {
    if (fila.nivel === "sinReferencia") {
      totalSinReferencia++;
      continue;
    }
    if (fila.nivel === "ok" || fila.nivel === "favorable" || fila.nivel === "muyFavorable") {
      totalFavorables++;
    } else {
      totalCriticos++;
    }
    if (fila.diferenciaAbsolutaVsMediana !== null && fila.diferenciaAbsolutaVsMediana > 0) {
      ahorroPotencialUnitarioVsMediana += fila.diferenciaAbsolutaVsMediana;
    }
  }

  return {
    totalCodigos: filas.length,
    totalConReferencia: filas.length - totalSinReferencia,
    totalSinReferencia,
    totalFavorables,
    totalCriticos,
    ahorroPotencialUnitarioVsMediana,
  };
}
