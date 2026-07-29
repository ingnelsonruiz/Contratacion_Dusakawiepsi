---
tags: [integraciones, webhooks]
---

# Webhooks

## Estado actual

> [!warning]
> Este proyecto **no expone ni consume webhooks hoy**. No hay endpoints públicos de callback ni integraciones basadas en eventos.

## Webhook planificado: disparo de ETL

El diseño de `docs/ARQUITECTURA.md` §3.3 contempla que el proceso ETL (`/api/etl/*`) sea "disparado por cron externo o botón manual". Un cron externo (ej. un servicio de scheduling que haga `POST /api/etl/refresh` cada noche) es funcionalmente equivalente a un webhook entrante.

| Aspecto | Detalle planificado |
|---|---|
| Endpoint | `POST /api/etl/*` (ruta exacta a definir en Fase 1) |
| Disparador | Cron externo (diario nocturno) o botón "Actualizar" en `/admin` |
| Autenticación | A definir — probablemente un secreto compartido en header, similar al patrón `x-api-key` del proxy de BD |
| Idempotencia | Requerida — el ETL debe poder reejecutarse sin duplicar agregados (UPSERT) |

> [!todo] No implementado
> No existe todavía ninguna ruta `/api/etl/*` en el código. Esta sección documenta el diseño aprobado para cuando se construya.

## Ver también
- [[APIs Externas]]
- [[Arquitectura General#3. Estrategia ETL]]
- [[Roadmap]]
