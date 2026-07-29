/**
 * Conexión a PostgreSQL vía el mismo Proxy HTTP que usa Proyecto_Dusakawi.
 *
 * Por qué: Vercel/hosting de despliegue tiene IP dinámica; el firewall de
 * base_sie_dusakawi solo autoriza la IP estática del proxy (Render). Este
 * proyecto es una aplicación NUEVA e independiente, pero apunta a LA MISMA
 * base de datos (esquema `administrativo`) porque los tarifarios, contratos
 * y RIPS son datos maestros que no deben duplicarse. La independencia del
 * proyecto vive en el código/deploy, no en los datos.
 *
 * Todas las tablas que este proyecto CREA/ESCRIBE llevan el prefijo
 * `negociacion_contratacion_` (ver docs/ARQUITECTURA.md, sección 3.2).
 * Las tablas SIE existentes (rips_*, ct_*, tb_*) se consultan SOLO LECTURA.
 */

const PROXY_URL = process.env.PROXY_URL || "https://pg-proxy.onrender.com/query";
// Fallback de desarrollo (mismo valor que usa Proyecto_Dusakawi) para no depender de
// .env.local mientras se configura el entorno local. En un despliegue real, definir
// PROXY_API_KEY como variable de entorno propia y no depender de este valor por defecto.
const PROXY_API_KEY = process.env.PROXY_API_KEY || "dusakawi-proxy-2024-clave-secreta";

const PROXY_TIMEOUT_MS = 90000; // 90s: consultas de agregación/ETL pueden tardar
const PROXY_MAX_RETRIES = 3;
const PROXY_RETRY_DELAY_MS = 8000;
// Mismo criterio que Proyecto_Dusakawi (ver Convenciones y Reglas Críticas del
// cerebro del proyecto): un 502/503 rápido = cold start de Render (reintentar);
// un 502/503 lento = timeout del gateway sobre una query pesada (NO reintentar,
// reintentar solo apilaría seq scans sobre la misma consulta costosa).
const PROXY_COLD_START_MAX_MS = 15000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function executeQuery(sql: string, params: any[] = [], source?: string): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= PROXY_MAX_RETRIES; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await fetchWithTimeout(
        PROXY_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": PROXY_API_KEY,
          },
          // `source` etiqueta la query en pg_stat_activity como
          // 'Contratacion_dusakawiepi/<source>' para diferenciarla de las
          // queries de Proyecto_Dusakawi que comparten el mismo proxy/BD.
          body: JSON.stringify({ sql, params, source: source ? `Contratacion_dusakawiepi/${source}` : "Contratacion_dusakawiepi" }),
          cache: "no-store",
        },
        PROXY_TIMEOUT_MS
      );

      const bodyText = await res.text();

      if (!res.ok) {
        const isHtmlResponse = bodyText.trimStart().startsWith("<");

        if (isHtmlResponse) {
          const elapsed = Date.now() - startedAt;
          const isServerError = res.status === 502 || res.status === 503;
          const looksLikeColdStart = isServerError && elapsed < PROXY_COLD_START_MAX_MS;

          if (looksLikeColdStart && attempt < PROXY_MAX_RETRIES) {
            console.warn(`[db] Proxy en cold start (${res.status}) tras ${elapsed}ms, intento ${attempt}/${PROXY_MAX_RETRIES}.`);
            lastError = new Error(`Proxy en cold start (${res.status})`);
            await new Promise((r) => setTimeout(r, 35000));
            continue;
          }

          if (isServerError && elapsed >= PROXY_COLD_START_MAX_MS) {
            throw new Error(
              `La consulta excedió el tiempo límite del proxy (${res.status} tras ${Math.round(elapsed / 1000)}s). Reduzca el rango de fechas o revise la consulta.`
            );
          }

          throw new Error(`El servicio proxy de base de datos no está disponible (${res.status}).`);
        }

        let detail = bodyText;
        try {
          const errData = JSON.parse(bodyText);
          detail = errData.details || errData.message || errData.error || bodyText;
        } catch {
          /* bodyText ya es el detalle */
        }
        throw new Error(`Error en Base de Datos (Proxy): ${res.status} ${res.statusText}${detail ? ` - ${String(detail).substring(0, 200)}` : ""}`);
      }

      return JSON.parse(bodyText);
    } catch (error: any) {
      lastError = error;
      const isRetryable =
        error?.name === "AbortError" ||
        error?.message?.includes("fetch") ||
        error?.message?.includes("network") ||
        error?.message?.includes("503") ||
        error?.message?.includes("504") ||
        error?.message?.includes("cold start") ||
        // "TypeError: terminated" (undici) y variantes de socket cerrado a
        // mitad de respuesta — visto 2026-07-29 con consultas pesadas del
        // módulo "Top Impacto Económico" (varias consultas de varios
        // segundos cada una contra el proxy): el proxy corta la conexión
        // antes de terminar de responder en vez de devolver un error HTTP
        // limpio. No es un error de sintaxis SQL ni de datos — reintentar
        // tiene sentido igual que un cold start.
        error?.message?.includes("terminated") ||
        error?.message?.includes("socket") ||
        error?.message?.includes("ECONNRESET") ||
        error?.message?.includes("other side closed") ||
        error?.code === "UND_ERR_SOCKET";
      if (attempt < PROXY_MAX_RETRIES && isRetryable) {
        console.warn(`[db] Proxy no responde (intento ${attempt}/${PROXY_MAX_RETRIES}). Reintentando en ${PROXY_RETRY_DELAY_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, PROXY_RETRY_DELAY_MS));
      } else {
        break;
      }
    }
  }

  console.error("[db] Fallo crítico de comunicación con el Proxy de BD:", lastError);
  throw lastError;
}

export const pool = {
  query: async (sql: string, params: any[] = [], source?: string) => executeQuery(sql, params, source),
  connect: async () => ({
    query: async (sql: string, params: any[] = [], source?: string) => executeQuery(sql, params, source),
    release: () => {},
  }),
};

export { executeQuery };
