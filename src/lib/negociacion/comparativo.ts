/**
 * Funciones puras del Módulo 2 — Comparativo entre Prestadores.
 *
 * Mismo principio de arquitectura que src/lib/negociacion/formato.ts: cálculo
 * de negocio en funciones puras, sin dependencias de Next.js/BD, testeables
 * de forma aislada.
 *
 * Reglas heredadas del componente legado (ver KnowledgeBase/05-ReglasNegocio/
 * Contratación.md), reimplementadas aquí con umbrales configurables (no
 * hardcodeados) por la inconsistencia detectada en el sistema legado:
 *   - Media y mediana por código.
 *   - Deduplicación por mejor precio (mismo prestador + código -> mejor precio).
 *   - Semáforo de variación porcentual: ±alertaPct% = OK, alertaPct–criticoPct% = alerta, >criticoPct% = crítico.
 */

import type { FilaComparativoCodigo, NivelSemaforo, ReferenciaVariacion, UmbralesSemaforo } from "@/types/comparativo";

export interface EstadisticasValor {
  minimo: number;
  maximo: number;
  promedio: number;
  mediana: number;
  /** (máximo - mínimo) / promedio * 100 — qué tan amplia es la variabilidad real del grupo. */
  amplitudPct: number;
}

/** Calcula min/máx/promedio/mediana/amplitud de un conjunto de valores (uno por prestador, ya deduplicado). */
export function calcularEstadisticas(valores: number[]): EstadisticasValor {
  if (valores.length === 0) {
    return { minimo: 0, maximo: 0, promedio: 0, mediana: 0, amplitudPct: 0 };
  }

  const ordenados = [...valores].sort((a, b) => a - b);
  const minimo = ordenados[0];
  const maximo = ordenados[ordenados.length - 1];
  const promedio = valores.reduce((acc, v) => acc + v, 0) / valores.length;

  const mitad = Math.floor(ordenados.length / 2);
  const mediana =
    ordenados.length % 2 !== 0 ? ordenados[mitad] : (ordenados[mitad - 1] + ordenados[mitad]) / 2;

  const amplitudPct = promedio > 0 ? ((maximo - minimo) / promedio) * 100 : 0;

  return { minimo, maximo, promedio, mediana, amplitudPct };
}

/** Variación porcentual de un valor puntual respecto a una referencia (promedio o mediana del grupo). */
export function calcularVariacionPct(valor: number, referencia: number): number {
  if (referencia <= 0) return 0;
  return ((valor - referencia) / referencia) * 100;
}

/**
 * Clasifica una variación porcentual (con signo: positivo = más caro que la
 * referencia, negativo = más barato) según los umbrales configurables.
 * NUNCA hardcodear 1/10 fuera de UMBRALES_SEMAFORO_DEFECTO — el usuario debe
 * poder ajustarlos en la UI.
 *
 * Distingue DIRECCIÓN, no solo magnitud (ver comentario de NivelSemaforo en
 * src/types/comparativo.ts): un prestador más caro que la referencia es un
 * riesgo a vigilar (alerta/crítico); uno más barato es una oportunidad, no
 * un riesgo, y se clasifica aparte (favorable/muyFavorable) aunque la
 * magnitud de la desviación sea la misma.
 */
export function clasificarSemaforo(variacionPct: number, umbrales: UmbralesSemaforo): NivelSemaforo {
  const absoluta = Math.abs(variacionPct);
  if (absoluta <= umbrales.alertaPct) return "ok";

  const masCaroQueLaReferencia = variacionPct > 0;
  if (absoluta > umbrales.criticoPct) {
    return masCaroQueLaReferencia ? "critico" : "muyFavorable";
  }
  return masCaroQueLaReferencia ? "alerta" : "favorable";
}

const ETIQUETAS_NIVEL_SEMAFORO: Record<NivelSemaforo, string> = {
  critico: "Crítico (más caro)",
  alerta: "Alerta (más caro)",
  ok: "OK",
  favorable: "Favorable (más barato)",
  muyFavorable: "Muy favorable (más barato)",
};

/** Etiqueta legible de un nivel de semáforo — única fuente de verdad, usada tanto en la UI como en las exportaciones Excel/CSV. */
export function etiquetaNivelSemaforo(nivel: NivelSemaforo): string {
  return ETIQUETAS_NIVEL_SEMAFORO[nivel];
}

/**
 * Filtra un arreglo de `FilaComparativoCodigo` a solo los códigos que tienen
 * >= 1 prestador en alguno de los `estados` pedidos, Y recorta la lista de
 * `prestadores` de cada código a solo esos prestadores coincidentes.
 *
 * Compartida entre `getComparativoPorMunicipio` (filtra antes de paginar) y
 * el Route Handler de exportación (`/api/export/comparativo`, que necesita
 * exactamente el mismo criterio para que el archivo descargado coincida con
 * lo que el usuario está viendo en pantalla). Si `estados` viene vacío o
 * undefined, no filtra nada (se devuelven los grupos tal cual).
 *
 * Corrección 2026-07-28: no basta con filtrar el CÓDIGO — si se muestran
 * todos sus prestadores igual, el usuario ve estados que no pidió ver.
 */
export function filtrarYRecortarPorEstados(
  grupos: FilaComparativoCodigo[],
  referencia: ReferenciaVariacion,
  umbrales: UmbralesSemaforo,
  estados?: NivelSemaforo[]
): FilaComparativoCodigo[] {
  if (!estados || estados.length === 0) return grupos;
  const set = new Set(estados);
  const coincide = (p: FilaComparativoCodigo["prestadores"][number]) => {
    const variacion = referencia === "promedio" ? p.variacionPctPromedio : p.variacionPctMediana;
    return set.has(clasificarSemaforo(variacion, umbrales));
  };
  return grupos
    .filter((g) => g.prestadores.some(coincide))
    .map((g) => {
      const prestadoresFiltrados = g.prestadores.filter(coincide);
      return { ...g, prestadores: prestadoresFiltrados, cantidadPrestadores: prestadoresFiltrados.length };
    });
}

/**
 * Deduplicación por mejor precio: cuando el mismo prestador (ips) tiene más
 * de una fila para el mismo código (ej. por múltiples contratos vigentes
 * simultáneos, o líneas repetidas dentro del mismo tarifario), se toma el
 * valor MÁS BAJO como el precio real de ese prestador para ese código.
 */
export function dedupMejorPrecio<T extends { ips: number; codigoTarifa: string; valorFinal: number }>(
  filas: T[]
): T[] {
  const mejores = new Map<string, T>();
  for (const fila of filas) {
    const clave = `${fila.ips}__${fila.codigoTarifa}`;
    const actual = mejores.get(clave);
    if (!actual || fila.valorFinal < actual.valorFinal) {
      mejores.set(clave, fila);
    }
  }
  return Array.from(mejores.values());
}
