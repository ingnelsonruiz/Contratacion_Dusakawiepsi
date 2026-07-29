---
tags: [integraciones, apis-externas]
---

# APIs Externas

## Integración activa: `pg-proxy` (Render)

| Aspecto | Detalle |
|---|---|
| **URL** | `https://pg-proxy.onrender.com/query` (configurable vía `PROXY_URL`) |
| **Propósito** | Único punto de acceso a `base_sie_dusakawi` (PostgreSQL 14.19), compartido con `Proyecto_Dusakawi` |
| **Autenticación** | Header `x-api-key` con `PROXY_API_KEY` |
| **Por qué existe** | El hosting de despliegue de la app tiene IP dinámica; el firewall de la BD solo autoriza la IP estática del proxy en Render |
| **Timeout** | 90 segundos por intento |
| **Reintentos** | Hasta 3, con lógica de cold-start vs. timeout real (ver [[Patrones#Proxy HTTP en vez de conexión directa a PostgreSQL]]) |
| **Trazabilidad** | Cada query se etiqueta `Contratacion_dusakawiepi/<source>` en `pg_stat_activity` |

Implementación completa en `src/lib/db.ts` — ver [[Middleware#src/lib/db.ts — proxy de base de datos]].

## Integraciones planificadas, no reutilizadas del sistema legado

### SISMED (API pública)

- **Estado en el sistema legado**: se consultaba **en vivo** en cada búsqueda (`clicsalud-price-search.tsx`).
- **Decisión para este proyecto**: **no reutilizar el patrón de consulta en vivo** (ver [[Decisiones ADR#ADR-007]]). Si se requiere benchmark externo, debe **ingerirse por batch** a `negociacion_contratacion_benchmark_mercado`.
- **Estado actual**: no implementado, Fase 6 (fuera del alcance inicial).

### datos.gov.co / otras fuentes de mercado

- Candidatas a fuente de `negociacion_contratacion_benchmark_mercado`, junto con el manual tarifario ISS 2001 y cotizaciones de otras EPS.
- Sin integración implementada.

## Integraciones descartadas explícitamente

| Integración legada | Por qué no se reutiliza |
|---|---|
| Google Sheets externos (`contracted-price-bulk-analyzer.tsx`, `contracted-services-search-form.tsx`) | Dependencia externa frágil, reemplazada por carga batch a tablas propias |
| CRUD de mantenimiento de tarifarios (`contract-tariff-manager.tsx`, `ium-tariff-validator.tsx`) | Es operación de ARYUWIS, no inteligencia de negociación — fuera del alcance de este proyecto |

## Ver también
- [[Servicios]]
- [[Webhooks]]
- [[Decisiones ADR]]
