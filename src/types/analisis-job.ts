/**
 * Tipos del patrón "job asíncrono con polling" (2026-08-02) — ver
 * db/migrations/003_analisis_job.sql y
 * src/lib/negociacion/analisis-job-store.ts para el diseño completo.
 *
 * Reemplaza, para el módulo "Análisis de Códigos de Mayor Impacto
 * Económico", el patrón anterior de "el navegador espera toda la respuesta
 * de una Server Action pesada" por: crear un job (respuesta inmediata),
 * procesarlo en segundo plano (`after()` de Next.js 15, sin infraestructura
 * externa), y que el cliente haga polling de su estado real.
 */

export type EstadoAnalisisJob = "pendiente" | "procesando" | "completado" | "error";

/** Snapshot de estado devuelto por cada poll — deliberadamente sin `filtros` completos ni datos crudos, solo lo necesario para pintar el progreso. */
export interface EstadoJobPayload {
  codigoJob: string;
  estado: EstadoAnalisisJob;
  progreso: number;
  etapa: string | null;
  etapaNumero: number | null;
  etapaTotal: number | null;
  /** Lista ordenada de etiquetas de TODAS las etapas de este job — para pintar el checklist ✓/🔄/○ sin recalcular en el cliente qué tipos aplican. */
  etapas: string[];
  mensaje: string | null;
  registrosProcesados: number;
  /** `null` mientras `estado !== 'completado'` — ver comentario en la migración sobre por qué no se inventa un total antes de terminar. */
  totalRegistros: number | null;
  codigosEncontrados: number;
  /** Solo presente si `estado === 'error'`: mensaje técnico corto (no expone stack trace) para depuración del analista/soporte. */
  error: string | null;
  /**
   * Segundos desde la última escritura del job (calculado en el servidor con
   * `now() - fecha_actualizacion`, no con el reloj del navegador). Usado por
   * el cliente para detectar un job MUERTO: en Vercel, el trabajo de
   * `after()` cuenta contra el límite de duración de la función según el
   * plan — si la plataforma mata el proceso a mitad del análisis, la fila
   * queda en 'procesando' para siempre sin nadie que la marque como error.
   * Umbral en el cliente: > 360s (mayor que el presupuesto máximo de una
   * sola consulta pesada, 300s, durante la cual legítimamente no hay
   * escrituras al job).
   */
  segundosDesdeActualizacion: number | null;
}

/** Resultado de `iniciarAnalisisImpactoJob` — lo único que el cliente recibe en la respuesta inicial (rápida). */
export interface IniciarJobResultado {
  codigoJob: string;
  /** `true` si se reutilizó un análisis reciente con los mismos filtros en vez de recalcular — ver `buscarJobReutilizable`. */
  reutilizado: boolean;
}
