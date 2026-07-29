---
tags: [deployment, vercel]
---

# Vercel

## Estado actual

> [!warning]
> No hay archivo `vercel.json` ni configuración de Vercel en el repositorio. La única referencia es conceptual, en `src/lib/db.ts`: "Vercel/hosting de despliegue tiene IP dinámica" — usado para justificar por qué se necesita el proxy de BD ([[APIs Externas]]), no como confirmación de que Vercel sea el hosting elegido.

## Por qué Vercel es el candidato natural

- El proyecto usa Next.js 15 App Router con Server Actions y Server Components — el patrón de despliegue más directo para este stack es Vercel (creador de Next.js).
- El resto del ecosistema Dusakawi sigue el mismo patrón de justificación de IP dinámica en sus comentarios de código, lo que sugiere que ya se despliega ahí.

## Consideraciones si se despliega en Vercel

| Aspecto | Detalle |
|---|---|
| Variables de entorno | `PROXY_URL`, `PROXY_API_KEY` deben configurarse en el dashboard de Vercel (no en `.env.local`, que no se despliega) — ver [[Variables]] |
| Timeout de función serverless | Verificar que el plan de Vercel soporte el timeout de 90s de `PROXY_TIMEOUT_MS` en `src/lib/db.ts` — el plan Hobby de Vercel limita funciones a 10s, lo que **rompería** cualquier query de agregación pesada |
| Cron jobs (ETL) | Vercel Cron Jobs sería la forma natural de disparar `/api/etl/*` cuando exista (ver [[Webhooks]]) |
| `next.config.ts` | `ignoreBuildErrors`/`ignoreDuringBuilds` ya están activos, así que el build no fallará por errores de tipos/lint pendientes |

> [!danger] Punto a validar antes de un despliegue real
> El timeout de 90 segundos configurado en `PROXY_TIMEOUT_MS` (`src/lib/db.ts`) **excede el límite de funciones serverless de los planes gratuitos/básicos de Vercel**. Esto debe confirmarse y resolverse (plan adecuado o Route Handler con `maxDuration` extendido) antes de desplegar los módulos de ETL/agregación pesada.

## Ver también
- [[Render]]
- [[Variables]]
- [[Middleware]]
