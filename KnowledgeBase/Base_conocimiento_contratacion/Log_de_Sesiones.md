---
name: Log_de_Sesiones
description: Historial de sesiones de trabajo — qué se hizo, qué se corrigió, qué quedó pendiente
ultima_actualizacion: 2026-09-08
---

# 📋 Log de Sesiones

> **Protocolo de actualización:** Al finalizar cada sesión, agregar una entrada con fecha, qué se implementó/corrigió, archivos modificados y pendientes que surgieron.

---

## Sesión 2026-09-08 (tarde) — Migración 001 + Cambio de Proxy

**Qué se hizo:**
- Migración `001_negociacion_contratacion_usuario.sql` aplicada en `base_sie_dusakawi.administrativo` vía DBeaver.
- Usuario `admin` creado con rol `admin` — login funcional en producción.
- Proxy HTTP migrado de `pg-proxy.onrender.com` (suspendido) a `pg-proxy-7pdn.onrender.com`.
- `src/lib/db.ts` actualizado: nuevo PROXY_URL y nuevo API_KEY (`v9mX7...BTx`).
- Pendiente: actualizar variables de entorno en Vercel (`PROXY_URL` + `PROXY_API_KEY`) y hacer redeploy.

**Archivos modificados:**
- `src/lib/db.ts` — nuevo URL y API key del proxy
- `scripts/migrate-and-seed.mjs` — script utilitario creado (nuevo)
- `KnowledgeBase/Base_conocimiento_contratacion/Tareas_Pendientes.md` — migración 001 marcada ✅
- `KnowledgeBase/Base_conocimiento_contratacion/Log_de_Sesiones.md` — este registro

**Pendientes surgidos:**
- Actualizar `PROXY_URL` y `PROXY_API_KEY` en Vercel + redeploy.
- Aplicar migración 002 (`precio_referencia_eps`) — sigue pendiente.

---

## Sesión 2026-09-08 — Creación de Base de Conocimiento

**Qué se hizo:**
- Se cargó la KnowledgeBase existente (carpetas 00–11 + Glosario.md) en su totalidad.
- Se creó la carpeta `KnowledgeBase/Base_conocimiento_contratacion/` con 9 archivos markdown que consolidan todo el conocimiento del proyecto en formato navegable para Claude.

**Archivos creados:**
- `HOME.md` — índice y estado general
- `Stack_y_Arquitectura.md` — tecnologías y patrones de implementación
- `Schema_Base_de_Datos.md` — esquema completo de tablas, columnas, relaciones
- `Reglas_de_Negocio.md` — reglas por módulo, fórmulas, umbrales
- `Convenciones_y_Reglas_Criticas.md` — reglas que nunca se pueden romper
- `Bugs_y_Correcciones.md` — 22 bugs documentados con correcciones
- `Estado_y_Roadmap.md` — fases completadas y pendientes
- `Modulos_y_API.md` — rutas, Server Actions, Route Handlers
- `Tareas_Pendientes.md` — migraciones, seguridad, deuda técnica
- `Log_de_Sesiones.md` — este archivo

**Estado del proyecto al cierre:**
- 8 módulos en producción (4 del plan original + 4 extra)
- 2 migraciones SQL sin aplicar en BD
- 22 bugs documentados (17 corregidos, 5 pendientes)
- Módulos 5, 6, 7 (real), 8 sin construir

**Pendientes surgidos en esta sesión:** Ninguno nuevo.

---

## Sesiones anteriores (2026-07-28 → 2026-08-02)

### 2026-08-02 — Revisión general del roadmap
- Se documentó la divergencia entre el plan original (docs/ARQUITECTURA.md) y el estado real.
- 4 módulos extra construidos no estaban contemplados.
- ETL de pre-agregación (Módulos 3 y 4) no implementado — funcionan en vivo con restricciones.

### 2026-07-31 — Módulos Análisis de Propuesta y Precios de Referencia EPS
- Completados `/analisis-propuesta` y `/precio-referencia-eps`.
- `obtenerReferenciasMercadoEps` implementada con captura defensiva de error si la tabla no existe.
- DDL `002_precio_referencia_eps.sql` escrito (no aplicado).

### 2026-07-30 — Corrección masiva de bugs en Top Impacto y Comparativo
- Bug 7 corregido: `rips_af.consecutivo_rips` no único — `DISTINCT ON` y `rips-dedup.ts`.
- Bug 9 corregido: municipio de agrupación era el de sede del prestador, no el del contrato.
- Bug 10 corregido: `codigo_tarifario` de `rips_at` siempre NULL — usar `codigo_servicio`.
- Bug 11 corregido: CUPS de estancia sin descripción — doble JOIN con `COALESCE`.
- Bug 12 corregido: facturas duplicadas por recarga de lotes — inflación 7.4% a nivel EPS.
- Bug 13 corregido: `TypeError: terminated` — consultas secuenciales + CTE materializada.
- Bug 15 corregido: `LEFT JOIN` hacia `ct_ips` — 7.9% del valor invisible con INNER JOIN.
- Bug 16 corregido: Error 413 — filtro de `rips_af` como subconsulta, sin pasar array por HTTP.
- Módulo 4 (`/consumo-frecuencia`) ampliado.

### 2026-07-29 — Módulos extra: Perfil Prestador, Top Impacto (v1)
- `/perfil-prestador` completado.
- `/top-impacto` v1 completado.
- Dashboard de Riesgo aislado en `dashboard-riesgo-tab.tsx`.
- Bug 4 corregido: semáforo sin dirección — falsos "críticos" para prestadores baratos.
- Bug 5 corregido: filtro de semáforo no recortaba prestadores dentro del código.
- Bug 6 corregido: amplitud % dividía por Promedio aunque referencia fuera Mediana.
- Bug 8 corregido: contratos capitados generaban falsos "críticos".
- Bug 9 identificado (corregido al día siguiente).

### 2026-07-28 — Fundación y Módulos 1–4 MVP
- Scaffold Next.js 15 + TypeScript strict + Tailwind + Shadcn UI.
- `db.ts` con modo dual (local/proxy) y errores reintentables.
- Middleware de sesión y login con SHA-256.
- Módulo 1 (`/tarifarios`) completado — `resolverValorFinal()`, clasificación de ítems.
- Bug 1 identificado y corregido: `consecutivo_cup` NULL → cruzar por `codigo_tarifa`.
- Bug 2 identificado y corregido: `consecutivo_medicamento` incorrecto.
- Bug 3 identificado y corregido: `consecutivo_insumo` NULL.
- Módulo 2 (`/comparativo`) completado con semáforo de 3 estados (luego ampliado a 5).
- Módulos 3 y 4 MVP completados.
- DDL `001_negociacion_contratacion_usuario.sql` escrito (no aplicado).

---

## Plantilla para nuevas sesiones

```
## Sesión YYYY-MM-DD — [Título breve]

**Qué se hizo:**
- ...

**Archivos modificados:**
- `ruta/archivo.ts` — descripción del cambio

**Bugs corregidos:**
- Bug N: descripción breve

**Pendientes surgidos:**
- ...
```
