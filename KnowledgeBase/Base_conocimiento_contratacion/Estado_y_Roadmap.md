---
name: Estado_y_Roadmap
description: Fases completadas, módulos en producción, módulos pendientes y roadmap actualizado
ultima_actualizacion: 2026-09-08
---

# 🗺️ Estado y Roadmap

> **Última revisión:** 2026-08-02  
> El roadmap real divergió del plan original — 4 módulos extra se construyeron, las Fases 3 y 4 se implementaron como MVP (sin ETL de pre-agregación), y el Módulo 8/Administración sigue sin construirse.

---

## Fases del Plan Original

| Fase | Alcance | Estado |
|---|---|---|
| **0 — Fundación** | Scaffold Next.js 15, `db.ts`/proxy, middleware de sesión, layout base, tabla `negociacion_contratacion_usuario` | ✅ Código listo — ⚠️ migración NO aplicada en BD |
| **1 — Tarifario Vigente e Histórico** | Consulta en vivo de contratos y tarifarios de ARYUWIS | ✅ Completada (2026-07-28) |
| **2 — Comparativo entre Prestadores** | Lógica estadística validada, siempre dentro del mismo municipio | ✅ Completada (2026-07-28, ampliada 2026-07-29) |
| **3 — Comparativo Histórico del Prestador** | Tarifa vigente HOY vs. foto congelada `historico_tarifas_2025` | ✅ MVP (2026-07-28→29) |
| **4 — Consumo y Frecuencia** | Consulta en vivo de RIPS reales, tope seguridad 92 días | ✅ MVP (2026-07-28, ampliada 2026-07-30) |
| **5 — Simulador de Escenarios** | Proyectar impacto de tarifa propuesta | ⏳ No iniciada |
| **6 — Benchmark de Mercado Externo** | Ingesta batch SISMED/datos.gov.co — diferida a propósito | ⏳ No iniciada |
| **7 — Dashboard Ejecutivo** | Placeholder visual en `/dashboard` | ⏳ Solo placeholder |
| **8 — Administración** | Solo existe la tabla `negociacion_contratacion_usuario` | ⏳ No iniciada |

---

## Módulos Extra (no contemplados originalmente — en producción ✅)

| Módulo | Ruta | Fecha |
|---|---|---|
| Perfil Competitivo del Prestador | `/perfil-prestador` | 2026-07-29 |
| Análisis de Códigos de Mayor Impacto Económico | `/top-impacto` | 2026-07-29→30 |
| Análisis de Propuesta del Prestador | `/analisis-propuesta` | 2026-07-31 |
| Precios de Referencia de Otras EPS | `/precio-referencia-eps` | 2026-07-31 |

---

## Módulos en Producción — Detalle

### `/tarifarios` — Módulo 1
- Consulta contratos vigentes y su detalle tarifario desde ARYUWIS (BD compartida).
- Clasifica ítems en: Procedimiento, Medicamento, Insumo, Paquete, Otro.
- Resuelve descripciones cruzando `codigo_tarifa` contra catálogos (`tb_cup`, `tb_medicamento`, `tb_insumo`).
- Valor final calculado con `resolverValorFinal()` (cascada de 4 campos).

### `/comparativo` — Módulo 2 + Dashboard de Riesgo Contractual
- Compara tarifas del mismo código entre prestadores **del mismo municipio**.
- Semáforo de 5 niveles (ok/alerta/crítico/favorable/muyFavorable).
- Referencia configurable: Promedio vs. Mediana.
- Score de Riesgo heurístico (0–100) con 4 componentes.
- Dashboard de Riesgo aislado en `dashboard-riesgo-tab.tsx`.

### `/historico-prestador` — Módulo 3 MVP
- Compara tarifa vigente del prestador contra foto congelada `historico_tarifas_2025`.
- Maneja códigos nuevos (solo en vigente) y eliminados (solo en 2025) sin falsa variación.

### `/consumo-frecuencia` — Módulo 4 MVP
- Consulta RIPS reales (`rips_ap`, `rips_am`, `rips_at`) filtrados vía `rips_af`.
- Rango máximo: 92 días (tope de seguridad por rendimiento).
- Estrategia: filtrar `rips_af` primero → lista `consecutivo_rips` → consultas secuenciales en tablas grandes.

### `/perfil-prestador`
- Perfil competitivo completo del prestador: contratos vigentes, municipios, tipos de servicio, posición relativa en el mercado local.

### `/top-impacto`
- Análisis de códigos de mayor impacto económico EPS-completa o por prestador.
- Drill-down Nivel 1 (todos los prestadores) y Nivel 2 (por código+prestador fijo).
- Usa `rips-dedup.ts` para deduplicar facturas duplicadas por recarga de lotes.
- Con `{ soloPorCodigo: true }` en drill-down para evitar consultas innecesarias.

### `/analisis-propuesta`
- Permite subir propuesta de tarifas del prestador (archivo temporal, nunca persiste en BD).
- Compara contra tarifario vigente, estadísticas del municipio y precios de referencia de otras EPS.
- Genera documento "Contrapropuesta" — **revisar antes de compartir externamente** (incluye identidad de terceros).

### `/precio-referencia-eps`
- Carga archivos de tarifas de otras EPS como referencia de mercado.
- Upsert por `(nit_entidad, municipio_codigo, codigo)` — actualiza sin duplicar.
- Botón "Aplicar migración" (rol `admin`) crea la tabla si no existe.

---

## ETL Planificado — No Implementado

La arquitectura destina tablas `negociacion_contratacion_consumo_agregado` y `negociacion_contratacion_snapshot_tarifario` para pre-agregar datos RIPS y evitar consultas en vivo sobre tablas de 60–177M filas. Actualmente los Módulos 3 y 4 consultan en vivo con restricciones (92 días, consultas secuenciales).

El Route Handler `/api/etl/*` **no existe**. El matching `prestador↔RIPS` está documentado pero no implementado (`src/lib/matching-prestador.ts` no existe).

---

## Verificación de Datos (KPIs reales post-corrección)

Tras aplicar la deduplicación de facturas (`rips-dedup.ts`):

| Métrica | Valor |
|---|---|
| Valor total radicado 2026 EPS-completa | $162.194.615.413 |
| Total registros | 4.314.174 |
| Total códigos distintos | 18.680 |
| Factura `MV06370` | 2 unidades / $170.000 ✅ (coincide con ARYUWIS) |
