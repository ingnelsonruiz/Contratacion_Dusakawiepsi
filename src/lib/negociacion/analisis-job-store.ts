/**
 * Acceso a BD del patrón "job asíncrono con polling" (2026-08-02) — sin
 * `"use server"` a propósito: es una librería interna importada por Server
 * Actions (`top-impacto-actions.ts`), no una Server Action en sí misma,
 * mismo criterio que `rips-dedup.ts`/`constantes.ts` en este mismo proyecto.
 *
 * Ver diseño completo y motivación en `db/migrations/003_analisis_job.sql`
 * y en el diagnóstico entregado al usuario 2026-08-02 (módulo Top Impacto).
 *
 * `pool.query` reenvía `params` tal cual al driver `pg` real en el proxy
 * (ver `pg-proxy/index.js` de Proyecto_Dusakawi, que este proyecto
 * comparte) — `pg` serializa automáticamente objetos JS planos a JSON para
 * columnas `jsonb` y los deserializa de vuelta a objeto al leer, así que
 * `filtros`/`resultado`/`etapas` se pasan y se leen como objetos/arrays de
 * JS normales, sin `JSON.stringify`/`JSON.parse` manual.
 */

import { pool } from "@/lib/db";
import { VENTANA_REUTILIZACION_JOB_MINUTOS } from "@/lib/negociacion/analisis-job";
import type { EstadoAnalisisJob, EstadoJobPayload } from "@/types/analisis-job";

const SOURCE = "analisis-job";
const TABLA = "administrativo.negociacion_contratacion_analisis_job";

/**
 * Serializa explícitamente a texto JSON antes de pasar como parámetro a una
 * columna `jsonb` — necesario porque `pg` (el driver real del lado del
 * proxy) NO trata igual los objetos planos que los arreglos: un objeto
 * (`{...}`) sí lo serializa solo con `JSON.stringify`, pero un ARREGLO en la
 * posición raíz del parámetro lo convierte primero a sintaxis de arreglo de
 * Postgres (`{"a","b"}`, con `Array.isArray()` evaluado ANTES que
 * `typeof === 'object'` en `prepareValue`), que NO es JSON válido para una
 * columna `jsonb` → `error: invalid input syntax for type json` (bug real
 * encontrado 2026-08-02 al guardar `etapas: string[]` sin este wrapper).
 * Se aplica igual a objetos (`filtros`, `resultado`) por consistencia y para
 * no depender de este detalle interno del driver en el resto del archivo.
 */
function paraJsonb(valor: unknown): string {
  return JSON.stringify(valor ?? null);
}

// -----------------------------------------------------------------------
// Creación perezosa de la tabla — mismo DDL que
// db/migrations/003_analisis_job.sql (si se edita uno, editar el otro).
// A diferencia de Precios de Referencia EPS (tabla opcional, gateada tras un
// botón "Aplicar migración" solo-admin), esta tabla es infraestructura de la
// que depende el flujo normal de "Consultar" de Top Impacto — se asegura
// sola en el primer uso, sin requerir que un admin entre a aplicar nada.
// `CREATE TABLE/INDEX IF NOT EXISTS` es barato y ya es el patrón usado en
// migraciones anteriores del proyecto (idempotente por diseño).
// -----------------------------------------------------------------------

let tablaLista = false;

export async function ensureTablaAnalisisJob(): Promise<void> {
  if (tablaLista) return;
  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS ${TABLA} (
          id                    BIGSERIAL PRIMARY KEY,
          codigo_job            VARCHAR(30) UNIQUE,
          modulo                VARCHAR(40) NOT NULL,
          estado                VARCHAR(20) NOT NULL DEFAULT 'pendiente'
              CHECK (estado IN ('pendiente','procesando','completado','error')),
          progreso              SMALLINT NOT NULL DEFAULT 0 CHECK (progreso BETWEEN 0 AND 100),
          etapa                 VARCHAR(150),
          etapa_numero          SMALLINT,
          etapa_total           SMALLINT,
          etapas                JSONB NOT NULL DEFAULT '[]'::jsonb,
          mensaje               TEXT,
          filtros               JSONB NOT NULL,
          filtros_hash          VARCHAR(64) NOT NULL,
          registros_procesados  BIGINT NOT NULL DEFAULT 0,
          total_registros       BIGINT,
          codigos_encontrados   INTEGER NOT NULL DEFAULT 0,
          resultado             JSONB,
          error                 TEXT,
          usuario               VARCHAR(100),
          rol                   VARCHAR(30),
          fecha_inicio          TIMESTAMPTZ NOT NULL DEFAULT now(),
          fecha_actualizacion   TIMESTAMPTZ NOT NULL DEFAULT now(),
          fecha_finalizacion    TIMESTAMPTZ
      )
    `,
    [],
    `${SOURCE}/ensure-tabla`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_analisis_job_reuso ON ${TABLA} (modulo, filtros_hash, estado, fecha_finalizacion DESC)`,
    [],
    `${SOURCE}/ensure-indice-reuso`
  );
  tablaLista = true;
}

interface CrearJobParams {
  modulo: string;
  filtros: Record<string, unknown>;
  filtrosHash: string;
  etapas: string[];
  usuario?: string | null;
  rol?: string | null;
}

/** Crea el job en estado 'pendiente' y le asigna su `codigo_job` legible ("AN-2026-000184"). 2 round-trips (INSERT + UPDATE) porque el código depende del `id` recién generado — ambos baratos, sin impacto real en el tiempo de respuesta que sí importa (la respuesta al navegador ocurre después de esto, sigue siendo del orden de cientos de ms, no segundos). */
export async function crearJob(params: CrearJobParams): Promise<string> {
  await ensureTablaAnalisisJob();
  const insert = await pool.query(
    `INSERT INTO ${TABLA} (modulo, filtros, filtros_hash, etapas, etapa, etapa_numero, etapa_total, usuario, rol)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)
     RETURNING id, fecha_inicio`,
    [params.modulo, paraJsonb(params.filtros), params.filtrosHash, paraJsonb(params.etapas), params.etapas[0] ?? null, params.etapas.length, params.usuario ?? null, params.rol ?? null],
    `${SOURCE}/crear`
  );
  const fila = insert?.rows?.[0];
  const id: number = fila?.id;
  const anio: number = new Date(fila?.fecha_inicio ?? Date.now()).getFullYear();
  const codigoJob = `AN-${anio}-${String(id).padStart(6, "0")}`;

  await pool.query(`UPDATE ${TABLA} SET codigo_job = $1 WHERE id = $2`, [codigoJob, id], `${SOURCE}/asignar-codigo`);
  return codigoJob;
}

interface ActualizacionJob {
  estado?: EstadoAnalisisJob;
  progreso?: number;
  etapa?: string;
  etapaNumero?: number;
  mensaje?: string;
  registrosProcesados?: number;
  codigosEncontrados?: number;
}

/** Actualización parcial — arma dinámicamente el `SET` según qué campos vengan definidos, siempre tocando `fecha_actualizacion` (usada por el cliente como señal de "el job sigue vivo, no se congeló"). */
export async function actualizarJob(codigoJob: string, cambios: ActualizacionJob): Promise<void> {
  const columnas: Record<string, unknown> = {
    estado: cambios.estado,
    progreso: cambios.progreso,
    etapa: cambios.etapa,
    etapa_numero: cambios.etapaNumero,
    mensaje: cambios.mensaje,
    registros_procesados: cambios.registrosProcesados,
    codigos_encontrados: cambios.codigosEncontrados,
  };
  const entradas = Object.entries(columnas).filter(([, v]) => v !== undefined);
  if (entradas.length === 0) return;

  const sets = entradas.map(([col], i) => `${col} = $${i + 1}`);
  sets.push(`fecha_actualizacion = now()`);
  const params = entradas.map(([, v]) => v);
  params.push(codigoJob);

  await pool.query(`UPDATE ${TABLA} SET ${sets.join(", ")} WHERE codigo_job = $${params.length}`, params, `${SOURCE}/actualizar`);
}

interface CompletarJobParams {
  resultado: unknown;
  registrosProcesados: number;
  codigosEncontrados: number;
}

export async function marcarJobCompletado(codigoJob: string, params: CompletarJobParams): Promise<void> {
  await pool.query(
    `UPDATE ${TABLA}
     SET estado = 'completado', progreso = 100, etapa = 'Análisis completado',
         resultado = $1, registros_procesados = $2, total_registros = $2, codigos_encontrados = $3,
         mensaje = NULL, fecha_actualizacion = now(), fecha_finalizacion = now()
     WHERE codigo_job = $4`,
    [paraJsonb(params.resultado), params.registrosProcesados, params.codigosEncontrados, codigoJob],
    `${SOURCE}/completar`
  );
}

/** `etapaFallida` se guarda en `etapa` (así el cliente muestra exactamente en qué paso falló, pedido explícito del usuario) — `errorTecnico` se loguea aparte con `console.error` en el llamador, aquí solo se persiste un resumen corto, nunca un stack trace completo. */
export async function marcarJobError(codigoJob: string, etapaFallida: string, mensajeAmigable: string, errorTecnico: string): Promise<void> {
  await pool.query(
    `UPDATE ${TABLA}
     SET estado = 'error', etapa = $1, mensaje = $2, error = $3,
         fecha_actualizacion = now(), fecha_finalizacion = now()
     WHERE codigo_job = $4`,
    [etapaFallida, mensajeAmigable, errorTecnico.slice(0, 500), codigoJob],
    `${SOURCE}/marcar-error`
  );
}

/** Job 'completado' más reciente con el mismo módulo+filtros, dentro de la ventana de reutilización — `null` si no hay ninguno o si la consulta falla (degradación defensiva: nunca bloquear un análisis nuevo porque la búsqueda de caché falló). */
export async function buscarJobReutilizable(modulo: string, filtrosHash: string): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT codigo_job FROM ${TABLA}
       WHERE modulo = $1 AND filtros_hash = $2 AND estado = 'completado'
         AND fecha_finalizacion > now() - interval '${VENTANA_REUTILIZACION_JOB_MINUTOS} minutes'
       ORDER BY fecha_finalizacion DESC
       LIMIT 1`,
      [modulo, filtrosHash],
      `${SOURCE}/buscar-reutilizable`
    );
    return result?.rows?.[0]?.codigo_job ?? null;
  } catch {
    return null;
  }
}

export async function obtenerEstadoJob(codigoJob: string): Promise<EstadoJobPayload | null> {
  const result = await pool.query(
    `SELECT codigo_job, estado, progreso, etapa, etapa_numero, etapa_total, etapas, mensaje,
            registros_procesados, total_registros, codigos_encontrados, error
     FROM ${TABLA} WHERE codigo_job = $1 LIMIT 1`,
    [codigoJob],
    `${SOURCE}/estado`
  );
  const r = result?.rows?.[0];
  if (!r) return null;
  return {
    codigoJob: r.codigo_job,
    estado: r.estado,
    progreso: Number(r.progreso ?? 0),
    etapa: r.etapa ?? null,
    etapaNumero: r.etapa_numero ?? null,
    etapaTotal: r.etapa_total ?? null,
    etapas: Array.isArray(r.etapas) ? r.etapas : [],
    mensaje: r.mensaje ?? null,
    registrosProcesados: Number(r.registros_procesados ?? 0),
    totalRegistros: r.total_registros === null || r.total_registros === undefined ? null : Number(r.total_registros),
    codigosEncontrados: Number(r.codigos_encontrados ?? 0),
    error: r.error ?? null,
  };
}

/** `resultado` viene ya deserializado como objeto (jsonb) — se tipa `unknown` aquí porque este archivo no conoce `ResultadoTopImpacto` (evita acoplar el store, genérico, a un módulo específico); el llamador en `top-impacto-actions.ts` hace el cast. */
export async function obtenerResultadoJob(codigoJob: string): Promise<{ estado: EstadoAnalisisJob; resultado: unknown } | null> {
  const result = await pool.query(
    `SELECT estado, resultado FROM ${TABLA} WHERE codigo_job = $1 LIMIT 1`,
    [codigoJob],
    `${SOURCE}/resultado`
  );
  const r = result?.rows?.[0];
  if (!r) return null;
  return { estado: r.estado, resultado: r.resultado ?? null };
}
