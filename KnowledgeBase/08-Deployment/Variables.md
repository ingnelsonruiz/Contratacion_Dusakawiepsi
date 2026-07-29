---
tags: [deployment, variables-entorno, configuracion]
---

# Variables de Entorno

Fuente: `.env.example`.

| Variable | Usada en | Obligatoria | Valor por defecto | Descripción |
|---|---|---|---|---|
| `PROXY_URL` | `src/lib/db.ts` | No (tiene fallback) | `https://pg-proxy.onrender.com/query` | URL del proxy HTTP hacia PostgreSQL |
| `PROXY_API_KEY` | `src/lib/db.ts` | Sí (en producción) | `dusakawi-proxy-2024-clave-secreta` (fallback de desarrollo) | Header `x-api-key` para autenticar contra el proxy |
| `ADMIN_USERNAME` | `scripts/seed-admin.ts` | Sí, solo para ese script | — | Usuario del primer administrador a crear |
| `ADMIN_PASSWORD` | `scripts/seed-admin.ts` | Sí, solo para ese script | — | Clave del primer administrador (nunca se persiste en texto plano) |

> [!danger] Riesgo de seguridad activo
> `PROXY_API_KEY` tiene un **valor por defecto hardcodeado en el código fuente** (`src/lib/db.ts`) como "fallback de desarrollo para no depender de `.env.local`". Si este fallback llega a un ambiente de producción sin que se sobrescriba explícitamente, la clave real quedaría expuesta en el repositorio. Ver [[Problemas Comunes]] para el detalle de riesgo y mitigación recomendada.

## Configuración local

```bash
cp .env.example .env.local
# completar PROXY_API_KEY (y opcionalmente PROXY_URL si difiere)
```

`.env` y `.env.local` están en `.gitignore` — no se versionan.

## Variables planificadas (no existen aún)

Ninguna documentada formalmente para los módulos futuros. Candidatas previsibles: credenciales o tokens para la ingesta batch de benchmark externo (Módulo 6), y posiblemente un secreto para autenticar el disparo del ETL (`/api/etl/*`, ver [[Webhooks]]).

## Ver también
- [[Middleware]]
- [[Vercel]]
- [[Problemas Comunes]]
