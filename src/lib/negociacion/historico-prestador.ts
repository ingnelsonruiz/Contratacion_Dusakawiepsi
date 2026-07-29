/**
 * Funciones puras del módulo Comparativo Histórico del Prestador.
 *
 * Mismo principio de arquitectura que src/lib/negociacion/comparativo.ts:
 * cálculo de negocio en funciones puras, sin dependencias de Next.js/BD,
 * testeables de forma aislada. Reutiliza deliberadamente `calcularVariacionPct`
 * y `clasificarSemaforo`/`etiquetaNivelSemaforo` del Módulo 2 — la semántica
 * de "aumentó = riesgo a vigilar, disminuyó = favorable" aplica exactamente
 * igual aquí, solo que la "referencia" ahora es el valor histórico de un
 * mismo prestador en vez del promedio/mediana de otros prestadores.
 */

import { calcularVariacionPct, clasificarSemaforo } from "@/lib/negociacion/comparativo";
import type { UmbralesSemaforo } from "@/types/comparativo";
import type { FilaHistoricoCodigo, KpisHistoricoPrestador, PuntoHistorico, TipoTarifaHistorico } from "@/types/historico-prestador";

/**
 * Combina el valor histórico ("2025") y el vigente hoy para UN código,
 * calculando variación y semáforo solo cuando ambos valores existen — no
 * tiene sentido comparar un valor real contra `null` (código nuevo o dado de
 * baja).
 */
export function construirFilaHistorico(
  codigoTarifa: string,
  descripcion: string,
  tipo: TipoTarifaHistorico,
  valor2025: number | null,
  valorVigente: number | null,
  umbrales: UmbralesSemaforo,
  contrato2025: string | null = null,
  contratoVigente: string | null = null
): FilaHistoricoCodigo {
  const ambosDisponibles = valor2025 !== null && valor2025 > 0 && valorVigente !== null && valorVigente > 0;

  const variacionAbsoluta = ambosDisponibles ? valorVigente! - valor2025! : null;
  const variacionPct = ambosDisponibles ? calcularVariacionPct(valorVigente!, valor2025!) : null;
  const nivel = ambosDisponibles ? clasificarSemaforo(variacionPct!, umbrales) : null;

  const puntos: PuntoHistorico[] = [];
  if (valor2025 !== null) puntos.push({ etiqueta: "2025", valor: valor2025 });
  if (valorVigente !== null) puntos.push({ etiqueta: "Vigente", valor: valorVigente });

  return {
    codigoTarifa,
    descripcion,
    tipo,
    valor2025,
    valorVigente,
    contrato2025,
    contratoVigente,
    variacionAbsoluta,
    variacionPct,
    nivel,
    puntos,
  };
}

/**
 * KPIs ejecutivos del prestador — los totales monetarios SOLO suman códigos
 * presentes en AMBOS lados (2025 y vigente): sumar un código que solo existe
 * en un lado distorsionaría el "incremento acumulado" con algo que en
 * realidad es una alta/baja de catálogo, no una negociación de precio.
 */
export function calcularKpisHistoricoPrestador(filas: FilaHistoricoCodigo[]): KpisHistoricoPrestador {
  let valorTotal2025 = 0;
  let valorTotalVigente = 0;
  let cantidadAumentaron = 0;
  let cantidadDisminuyeron = 0;
  let cantidadSinCambio = 0;
  let cantidadNuevos = 0;
  let cantidadEliminados = 0;
  let cantidadCodigosComparados = 0;

  for (const fila of filas) {
    if (fila.valor2025 !== null && fila.valorVigente !== null && fila.variacionAbsoluta !== null) {
      cantidadCodigosComparados++;
      valorTotal2025 += fila.valor2025;
      valorTotalVigente += fila.valorVigente;
      if (fila.variacionAbsoluta > 0) cantidadAumentaron++;
      else if (fila.variacionAbsoluta < 0) cantidadDisminuyeron++;
      else cantidadSinCambio++;
    } else if (fila.valorVigente !== null && fila.valor2025 === null) {
      cantidadNuevos++;
    } else if (fila.valor2025 !== null && fila.valorVigente === null) {
      cantidadEliminados++;
    }
  }

  const incrementoAcumulado = valorTotalVigente - valorTotal2025;
  const incrementoAcumuladoPct = valorTotal2025 > 0 ? (incrementoAcumulado / valorTotal2025) * 100 : 0;

  return {
    valorTotal2025,
    valorTotalVigente,
    incrementoAcumulado,
    incrementoAcumuladoPct,
    cantidadCodigosComparados,
    cantidadAumentaron,
    cantidadDisminuyeron,
    cantidadSinCambio,
    cantidadNuevos,
    cantidadEliminados,
  };
}
