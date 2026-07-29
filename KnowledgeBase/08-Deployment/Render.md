---
tags: [deployment, render]
---

# Render

## Uso actual: proxy de base de datos (no la app en sí)

Render se usa hoy exclusivamente para alojar el **proxy HTTP hacia PostgreSQL** (`pg-proxy.onrender.com`), no para desplegar la aplicación Next.js de este proyecto. Ver [[APIs Externas#Integración activa: pg-proxy (Render)]].

## Implicación de arquitectura: cold starts

El proxy en Render puede tener **cold start** (arranque en frío tras inactividad), lo que se manifiesta como una respuesta 502/503 rápida (<15 segundos). `src/lib/db.ts` distingue explícitamente este caso de un timeout real de query pesada:

| Escenario | Código HTTP | Tiempo transcurrido | Acción |
|---|---|---|---|
| Cold start | 502/503 | < 15s (`PROXY_COLD_START_MAX_MS`) | Reintentar tras 35s |
| Timeout de query pesada | 502/503 | ≥ 15s | Fallar con mensaje: "reduzca el rango de fechas" |

Ver diagrama completo en [[Patrones#Proxy HTTP en vez de conexión directa a PostgreSQL]].

## ¿Se desplegará la app en Render?

No hay decisión documentada. `docs/ARQUITECTURA.md` menciona genéricamente "Vercel/hosting de despliegue" al justificar por qué se necesita el proxy (IP dinámica), lo que sugiere que la app probablemente se despliegue en Vercel (ver [[Vercel]]) mientras que Render queda reservado para el proxy de BD — pero esto **no está confirmado como decisión de arquitectura**.

## Ver también
- [[Vercel]]
- [[APIs Externas]]
- [[Middleware]]
