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
4. **Aplicar también `db/migrations/002_precio_referencia_eps.sql`** (2026-07-31) — bloqueante específico del módulo "Precios de Referencia de Otras EPS": sin esta tabla, la carga/consulta de ese módulo falla, y la integración con Análisis de Propuesta simplemente no encuentra referencias de mercado (falla capturada en `obtenerReferenciasMercadoEps`, no rompe el resto del análisis). Se puede aplicar manualmente o desde la propia UI (`/precio-referencia-eps`, botón "Aplicar migración", solo rol `admin`). Ver [[Tablas#Tabla implementada: `negociacion_contratacion_precio_referencia_eps` (2026-07-31)]].

> [!info] Actualizado 2026-08-02
> Los 2 primeros puntos siguen siendo el mismo bloqueante documentado desde el scaffold inicial — no hay evidencia en esta base de que se hayan resuelto todavía. Confirmar con el equipo si ya se aplicaron antes de asumir que siguen pendientes.

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
- [x] **Media/mediana mostradas ambas al usuario** — resuelto: selector "Comparar contra: Promedio/Mediana" en la UI, ambas variaciones se calculan siempre en el servidor (ver [[Contratación#Media y mediana — el usuario elige la referencia]])
- [ ] **Filtro de vigencia histórica** — v1 solo compara contratos vigentes hoy; no hay forma de comparar "cómo era la variabilidad hace 6 meses" (mismo alcance que el Módulo 1)

## Módulo 3 — Comparativo Histórico del Prestador ✅ MVP (2026-07-28→29)

Ver detalle completo en [[Contratación#Reglas implementadas — Módulo 3 (Comparativo Histórico del Prestador) ✅ MVP]] y [[Roadmap]].

- [x] Comparación de 2 puntos (foto `historico_tarifas_2025` vs. tarifa vigente hoy) — no serie temporal real
- [x] Reutilización del semáforo del Módulo 2 (misma clasificación, otra referencia)
- [x] Segmentadores clicables (comparados/nuevos/eliminados) + sub-segmentador subieron/bajaron/igual
- [x] Gráfico SVG propio (sin `recharts`, que quedó corrupto en el sandbox de desarrollo — ver [[Problemas Comunes#12]])
- [x] Export Excel/CSV (`/api/export/historico-prestador`)
- [ ] **2ª iteración diferida con el usuario**: ranking Top 20 de incrementos/disminuciones, comparación contrato-contra-contrato, observaciones automáticas en texto (por reglas de negocio, no IA generativa)
- [ ] Serie temporal real de 3+ años — depende de que exista el ETL de snapshots versionados (`negociacion_contratacion_snapshot_tarifario`, no implementado)

## Módulo 4 — Consumo y Frecuencia ✅ MVP (2026-07-28→30)

Ver detalle completo en [[Contratación#Reglas implementadas — Módulo 4 (Consumo y Frecuencia) ✅ MVP]] y [[Roadmap]].

- [x] Consulta en vivo de RIPS (sin ETL) — patrón "filtrar `rips_af` primero, saltar a tablas grandes por `consecutivo_rips` indexado"
- [x] Alcance: Servicios + Medicamentos + Insumos (Consultas y Hospitalizaciones quedaron fuera del MVP)
- [x] Rango de fechas día-a-día con tope de seguridad de 92 días (reemplazó el selector de mes único, 2026-07-30)
- [x] Deduplicación de facturas re-radicadas (`facturas_canonicas`, fix crítico 2026-07-30 — ver [[Tablas#`rips_af` — una misma factura puede aparecer duplicada en varios lotes]])
- [ ] Cruce contra el valor **contratado** para detectar sobre/subfacturación — es el objetivo de un módulo distinto ("Sobrecostos y Ahorro", Fase 4 original, sin iniciar)
- [ ] Serie temporal de varios meses en una sola vista — posible 2ª iteración si el rendimiento de un mes se valida aceptable en producción real
- [ ] Ranking de todos los prestadores a la vez (hoy es un prestador a la vez)

## Módulos nuevos ✅ (no contemplados en el roadmap original)

Ver detalle completo de cada uno en [[Contratación]], [[Roadmap#Módulos nuevos]] y [[API]].

- [x] **Perfil Competitivo del Prestador** (2026-07-29) — `/perfil-prestador`
- [x] **Dashboard Analítico de Riesgo Contractual** (2026-07-29) — pestaña nueva del Módulo 2, Fase A únicamente (boxplot/outliers/indicadores estadísticos avanzados quedaron en Fase B/C, sin iniciar)
- [x] **Análisis de Códigos de Mayor Impacto Económico** (2026-07-29→30) — `/top-impacto`
  - [ ] Filtro "Contrato" no acota por `consecutivo_contrato` exacto (acota por prestador, luego suma toda su actividad del año) — limitación conocida, documentada en [[Tablas]]
- [x] **Análisis de Propuesta del Prestador** (2026-07-31) — `/analisis-propuesta`
- [x] **Precios de Referencia de Otras EPS** (2026-07-31) — `/precio-referencia-eps`
  - [ ] Migración `002_precio_referencia_eps.sql` sin confirmar aplicada en producción (ver bloqueante #4 arriba)

## Próximo hito de producto

Con los Módulos 1-4 más los 4 módulos nuevos ya en producción, los candidatos naturales del roadmap original que faltan son: **Módulo 5 — Simulador de Escenarios**, **Sobrecostos y Ahorro** (cruce tarifa vs. consumo real) y **Módulo 8 — Administración** (hoy sin ninguna UI, solo la tabla de usuarios). El Módulo 6 (Benchmark externo) sigue diferido a propósito. Confirmar prioridad con el usuario antes de iniciar cualquiera — no hay una decisión documentada de cuál sigue.

Ver detalle completo en [[Roadmap]].

## Decisiones técnicas aún no tomadas

- Estrategia de manejo de estado de filtros interactivos en cliente (React Query/SWR vs. 100% Server Components) — ver [[Estados#Sin React Query / SWR]].
- Hosting definitivo de despliegue (Vercel es el candidato más probable, no confirmado — ver [[Vercel]]).
- Mecanismo de autenticación del disparo del ETL (`/api/etl/*`) — ver [[Webhooks]].

## Ver también
- [[Roadmap]]
- [[Mejoras]]
- [[Bugs]]
