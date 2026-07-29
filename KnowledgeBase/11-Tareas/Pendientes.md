---
tags: [tareas, pendientes]
---

# Pendientes

## Checklist de Fase 0 (según README.md)

- [x] Scaffold Next.js 15 + TypeScript + Tailwind + Shadcn UI
- [x] `src/lib/db.ts` — proxy PostgreSQL
- [x] Migración `negociacion_contratacion_usuario` (script listo)
- [ ] **Migración aplicada en la base de datos real** — pendiente, requiere credenciales de escritura (ver [[Flujo Migración]])
- [x] Middleware de sesión + login + Server Actions de autenticación
- [ ] **Verificación de build** (`npm install && npm run build`) — no confirmado en este análisis

## Bloqueante inmediato antes de cualquier uso real

1. Aplicar `db/migrations/001_negociacion_contratacion_usuario.sql` contra `base_sie_dusakawi` con credenciales de escritura.
2. Ejecutar `npm run seed:admin` con `ADMIN_USERNAME`/`ADMIN_PASSWORD` para crear el primer usuario.
3. Confirmar `PROXY_API_KEY` real en `.env.local` (no depender del fallback hardcodeado — ver [[Problemas Comunes]]).

## Módulo 1 — Tarifario Vigente e Histórico ✅ Completado (2026-07-28)

- [x] Server Actions de solo lectura (`src/app/actions/tarifario-actions.ts`)
- [x] Tipos (`src/types/tarifarios.ts`) y helpers puros (`src/lib/negociacion/formato.ts`, `exportar.ts`)
- [x] UI de listado `/tarifarios` (filtros, búsqueda, paginación server-side)
- [x] UI de detalle `/tarifarios/[id]` (encabezado + 5 pestañas)
- [x] Exportación Excel/CSV + impresión (`/api/export/tarifario`)
- [x] Dashboard actualizado (tarjeta "Disponible" enlazando a `/tarifarios`)
- [ ] **ETL de snapshot histórico** (`negociacion_contratacion_snapshot_tarifario`) — se implementó el módulo consultando ARYUWIS **en vivo**, sin snapshots versionados todavía. Necesario solo si se requiere comparar el tarifario entre distintos períodos (ej. "cómo estaba este contrato hace 6 meses"); el uso actual (consultar el tarifario vigente) no lo necesita.

## Módulo 2 — Comparativo entre Prestadores ✅ Completado (2026-07-28)

Origen: el usuario pidió poder comparar tarifas entre prestadores, señalando que la variabilidad "normal" (por ubicación del contrato) no debe mezclarse con la variabilidad real de negociación — por eso toda comparación en este módulo ocurre **dentro de un mismo municipio**.

- [x] Tipos (`src/types/comparativo.ts`)
- [x] Helpers puros de estadística/semáforo (`src/lib/negociacion/comparativo.ts`): `calcularEstadisticas`, `calcularVariacionPct`, `clasificarSemaforo` (umbrales configurables, no hardcodeados), `dedupMejorPrecio`
- [x] Server Actions de solo lectura (`src/app/actions/comparativo-actions.ts`): `getOpcionesMunicipios`, `getComparativoPorMunicipio`, `getComparativoPorCodigo`
- [x] UI `/comparativo` con 2 pestañas: "Comparativo por municipio" (todos los códigos con ≥2 prestadores) y "Buscar código específico" (agrupado por municipio)
- [x] Panel de umbrales del semáforo configurable en la propia UI (por defecto ±1% OK / 1–10% alerta / >10% crítico)
- [x] Dashboard actualizado (tarjeta "Disponible" enlazando a `/comparativo`)
- [x] Verificado con datos reales: Valledupar (34 prestadores, 20.936 filas crudas de servicios) — ver hallazgo de contratos capitados en [[Tablas#Módulo 2 (Comparativo)]]
- [ ] **Media/mediana mostradas ambas al usuario** — se calculan las dos, pero el semáforo solo usa el promedio como referencia; evaluar si mostrar el badge también contra mediana en una iteración futura
- [ ] **Filtro de vigencia histórica** — v1 solo compara contratos vigentes hoy; no hay forma de comparar "cómo era la variabilidad hace 6 meses" (mismo alcance que el Módulo 1)

## Próximo hito de producto: Módulo 3

Iniciar el **Módulo 3 — Consumo y Frecuencia**, que introduce el ETL de agregación de RIPS (la pieza más pesada en rendimiento del roadmap).

Ver detalle completo en [[Roadmap]].

## Decisiones técnicas aún no tomadas

- Estrategia de manejo de estado de filtros interactivos en cliente (React Query/SWR vs. 100% Server Components) — ver [[Estados#Sin React Query / SWR]].
- Hosting definitivo de despliegue (Vercel es el candidato más probable, no confirmado — ver [[Vercel]]).
- Mecanismo de autenticación del disparo del ETL (`/api/etl/*`) — ver [[Webhooks]].

## Ver también
- [[Roadmap]]
- [[Mejoras]]
- [[Bugs]]
