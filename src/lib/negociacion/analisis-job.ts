import crypto from "node:crypto";

/**
 * Helpers puros del patrón "job asíncrono con polling" (2026-08-02) — sin
 * acceso a BD (eso vive en `analisis-job-store.ts`), para que sean testeables
 * de forma aislada, mismo criterio que el resto de `src/lib/negociacion/`
 * (ver Objetivos.md § Principios no negociables: "Todo cálculo... es una
 * función pura y testeable en src/lib/negociacion/").
 */

/**
 * Hash estable de un objeto de filtros — ordena las claves antes de
 * serializar para que `{a:1,b:2}` y `{b:2,a:1}` produzcan el mismo hash
 * (los filtros del módulo Top Impacto se arman como objeto literal en el
 * cliente, así que el orden de propiedades no está garantizado). Usado
 * únicamente para decidir si se puede reutilizar un análisis reciente
 * idéntico — NO es un dato sensible ni criptográfico, sha256 es sobrado
 * aquí, se reutiliza solo porque ya es el estándar del proyecto (ver
 * `sha256Hex` en `src/lib/auth.ts`).
 */
export function calcularHashFiltros(filtros: Record<string, unknown>): string {
  const normalizado = ordenarClaves(filtros);
  return crypto.createHash("sha256").update(JSON.stringify(normalizado), "utf8").digest("hex");
}

function ordenarClaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarClaves);
  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    return Object.keys(objeto)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = ordenarClaves(objeto[k]);
        return acc;
      }, {});
  }
  return valor;
}

/**
 * Etapas "de preparación" y "de cierre" que envuelven las etapas por tipo
 * (servicios/consultas/medicamentos/insumos) — el total de etapas de un job
 * es siempre `1 (preparar) + N tipos seleccionados + 1 (construir TOP 100)`.
 * Con `tipo="todos"` son 6 etapas; con un tipo específico, 3.
 */
export const ETAPA_PREPARANDO = "Preparando información";
export const ETAPA_CONSTRUYENDO_TOP = "Construyendo TOP 100 y rankings";

export const ETIQUETAS_ETAPA_POR_TIPO: Record<"servicios" | "consultas" | "medicamentos" | "insumos", string> = {
  servicios: "Procesando servicios",
  consultas: "Procesando consultas",
  medicamentos: "Procesando medicamentos",
  insumos: "Procesando insumos",
};

/**
 * Progreso (0-100) según la etapa actual dentro del total de etapas del job.
 * Reserva 0-5% para "preparando" y 95-100% para el cierre/completado real
 * (nunca se llega a 100 aquí — el 100% solo lo pone `marcarJobCompletado`,
 * cuando el resultado YA está guardado, no antes, para que el cliente nunca
 * vea "100%" sin datos listos para mostrar).
 */
export function calcularProgresoEtapa(etapaNumero: number, etapaTotal: number): number {
  if (etapaTotal <= 0) return 5;
  const fraccion = Math.min(1, Math.max(0, etapaNumero / etapaTotal));
  return Math.round(5 + fraccion * 90);
}

/** Ventana de reutilización de un análisis reciente con los mismos filtros — evita recalcular si dos usuarios (o el mismo, dos veces) consultan lo mismo en poco tiempo, sin sobre-ingeniería (sin invalidación por escritura: los RIPS de un período cerrado no cambian minuto a minuto). */
export const VENTANA_REUTILIZACION_JOB_MINUTOS = 15;

/** Cuántas veces como máximo el cliente hace polling antes de mostrar un aviso de "esto está tardando anormalmente" — a diferencia del viejo `TIMEOUT_AVISO_CONSULTA_MS`, esto ya no es una adivinanza sobre un HTTP colgado: el job puede seguir 100% vivo y progresando en el servidor aunque el polling tarde en confirmarlo, así que el aviso es solo informativo, no corta la consulta. */
export const POLLING_INTERVALO_MS = 1800;
export const POLLING_MAX_INTENTOS = 200; // 200 * 1.8s = 6 minutos
