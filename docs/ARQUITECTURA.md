# Sistema de Inteligencia de Precios para Negociación de Contratos — DUSAKAWI EPSI

**Propuesta de Arquitectura Funcional y Técnica**
Proyecto: `C:\Proyecto\Contratacion_dusakawiepi`
Estado: propuesta para aprobación — ningún código de aplicación ha sido escrito todavía.
Fecha: 2026-07-27

---

## 1. Análisis del problema

### 1.1 Qué existe hoy (Proyecto_Dusakawi) y qué se reutiliza

El componente actual "Gestión de Inteligencia de Precios" vive como una pestaña dentro del "Módulo de Analítica de Datos" (`analytics-content.tsx`), protegida por un login hardcodeado de 2 usuarios en `sessionStorage` (no apto para un sistema independiente). Su lógica real está en `contracted-price-search-dsk.tsx` (3.348 líneas) y 14 funciones de `db-actions.ts`. Hallazgos clave que definen la arquitectura nueva:

- **La comparación "2025 vs 2026" es una foto congelada, no una serie histórica real.** La tabla `administrativo.historico_tarifas_2025` (308.231 filas) se llena por carga manual de un Excel/Google Sheet (`readHistoricoLocalFile`, `truncateHistorico2025Table`, `insertHistoricoChunk`). El "2026" es una consulta en vivo a `tb_tarifario_propio_detalle` + `ct_ips_contrato` + `ct_ips`. Esto significa que **hoy no existe una verdadera serie temporal de tarifas** — solo dos cortes. El sistema nuevo debe corregir esto con snapshots versionados reales.
- **Comparación estadística ya validada y con valor real**: cálculo de media/mediana por código, deduplicación por mejor precio (NIT+código), semáforo de variación % (±1% ok, 1–10% alerta, >10% crítico), cruce contra consumo real (RIPS AP/AM) para estimar impacto financiero y ahorro potencial. Esta lógica **sí se reutiliza como base conceptual**, pero se reescribe limpia y parametrizable (hoy hay umbrales inconsistentes: 10% en un módulo, ±5 COP absolutos en otro).
- **Matching prestador↔RIPS fue resuelto con 4 estrategias de fallback** (código habilitación, NIT, NIT sin últimos 3 dígitos, NIT sin ceros) porque no hay una llave limpia única. Se reutiliza tal cual — es conocimiento de dominio ya validado, no lógica descartable.
- **No se reutiliza**: el gate de autenticación hardcodeado, la dependencia de Google Sheets externos (`contracted-price-bulk-analyzer.tsx`, `contracted-services-search-form.tsx`), el scraping de la API pública SISMED en vivo en cada búsqueda (`clicsalud-price-search.tsx` — si se quiere benchmark de mercado externo, debe ingerirse a una tabla propia, no consultarse en vivo), y el CRUD de mantenimiento de tarifarios (`contract-tariff-manager.tsx`, `ium-tariff-validator.tsx`) que es operación de ARYUWIS, no inteligencia de negociación.

### 1.2 Restricción de rendimiento que condiciona toda la arquitectura

Las tablas fuente de consumo real son enormes y **no están indexadas para este caso de uso**:

| Tabla | Filas | Índice sobre código/fecha |
|---|---:|---|
| `rips_ap` (procedimientos) | ~177,7 M | No |
| `rips_am` (medicamentos) | ~81,8 M | No |
| `rips_at` (insumos) | ~60,1 M | No |
| `tb_tarifario_propio_detalle` | ~1,45 M | Solo por `consecutivo_cup/medicamento/insumo/paquete`, no por `codigo_tarifa` suelto |

Consultar estas tablas en vivo cada vez que un analista de contratación abra un dashboard (como hace el componente actual) es viable para casos puntuales pero **no escala** a un sistema de BI con múltiples usuarios y dashboards recurrentes. Por eso la arquitectura propuesta se apoya en un **proceso ETL propio** que pre-agrega estas tablas hacia el nuevo esquema `negociacion_contratacion_*`, dejando la consulta en vivo solo para casos de detalle puntual (drill-down de una factura específica).

---

## 2. Arquitectura propuesta

### 2.1 Stack (idéntico al resto de proyectos Dusakawi, sin excepciones)

- Next.js 15 (App Router) + React 18 + TypeScript `strict`.
- Tailwind CSS + Shadcn UI (Radix) — mismo design system, para que el equipo no reaprenda nada.
- Server Actions para mutaciones desde componentes; Route Handlers (`route.ts`) para endpoints consumidos por el propio frontend vía fetch, exportaciones binarias (Excel/PDF) o integraciones externas.
- PostgreSQL 14.19 vía el mismo `pg-proxy` (Render) → `base_sie_dusakawi`, esquema `administrativo`. **Sin ORM** — SQL nativo parametrizado (`$1, $2…`), mismo patrón `executeQuery()` de `src/lib/db.ts`.
- Recharts para visualización (ya usado en el ecosistema, evita dependencias nuevas).
- ExcelJS + jsPDF/autotable para exportación (mismo patrón que Proyecto_Dusakawi).

### 2.2 Por qué la misma BD y no una BD nueva

Los datos maestros de precios (tarifarios, contratos, prestadores) y los datos de consumo real (RIPS) **viven y deben seguir viviendo** en `base_sie_dusakawi` — es la única fuente de verdad y duplicarla generaría desincronización. La independencia del proyecto se logra a nivel de **aplicación** (repo, deploy y código 100% separados en `Contratacion_dusakawiepi`) y a nivel de **datos propios** (tablas nuevas con prefijo `negociacion_contratacion_`), no separando la BD física.

### 2.3 Estructura de carpetas propuesta

```
C:\Proyecto\Contratacion_dusakawiepi\
├── src/
│   ├── app/
│   │   ├── (contratacion)/                 # Rutas protegidas por middleware
│   │   │   ├── dashboard/                  # Panel ejecutivo (indicadores estratégicos)
│   │   │   ├── login/
│   │   │   ├── tarifarios/                 # Módulo 1: Tarifario vigente + histórico
│   │   │   ├── comparativo/                # Módulo 2: Comparación entre prestadores
│   │   │   ├── consumo/                    # Módulo 3: Consumo y frecuencia
│   │   │   ├── sobrecostos/                # Módulo 4: Sobrecostos y ahorro
│   │   │   ├── simulador/                  # Módulo 5: Simulador de escenarios
│   │   │   ├── benchmark/                  # Módulo 6: Referencia de mercado externo
│   │   │   └── admin/                      # Usuarios, auditoría, exclusiones de datos
│   │   ├── api/
│   │   │   ├── etl/                        # Route handlers de refresco ETL (cron-triggered)
│   │   │   └── export/                     # Descargas Excel/PDF
│   │   └── actions/                        # Server Actions (una por dominio, no un archivo gigante)
│   │       ├── tarifario-actions.ts
│   │       ├── comparativo-actions.ts
│   │       ├── consumo-actions.ts
│   │       ├── simulador-actions.ts
│   │       └── admin-actions.ts
│   ├── components/
│   │   ├── ui/                             # Shadcn (copiado del proyecto base)
│   │   ├── tarifarios/ · comparativo/ · consumo/ · simulador/ · benchmark/ · dashboard/
│   ├── lib/
│   │   ├── db.ts                           # Mismo patrón de proxy HTTP
│   │   ├── etl/                            # Jobs de agregación (ver 3.3)
│   │   ├── matching-prestador.ts           # Reutiliza las 4 estrategias de match NIT/habilitación
│   │   └── negociacion/                    # Reglas de negocio puras (umbrales, semáforos, cálculo de ahorro)
│   ├── types/
│   └── middleware.ts
└── docs/
    └── ARQUITECTURA.md                     # Este documento, vivo
```

**Decisión de diseño clave**: nada de lógica de negocio (umbrales de variación, fórmulas de ahorro, reglas de matching) vive dentro de componentes `.tsx`. Todo va en `src/lib/negociacion/` como funciones puras y testeables — corrige el defecto del componente original (3.348 líneas con lógica de negocio mezclada con JSX).

---

## 3. Modelo de datos

### 3.1 Tablas SIE existentes — se consultan de solo lectura, nunca se modifican

| Tabla | Uso en este proyecto |
|---|---|
| `ct_ips_contrato`, `ct_ips` | Contratos vigentes y datos del prestador (NIT, código habilitación, razón social) |
| `tb_tarifario_propio_encabezado`, `tb_tarifario_propio_detalle` | Tarifario contratado vigente por servicios/medicamentos/insumos (`tipo_tarifa`) |
| `tb_cup`, `tb_medicamento`, `tb_insumo`, `tb_concepto_nota_tecnica` | Maestros de descripción/clasificación de códigos |
| `rips_ap`, `rips_am`, `rips_at`, `rips_resumen`, `rips_af` | Consumo real facturado (fuente del ETL de agregación) |
| `log_sc_factura_pago_detallado` | Costo real pagado (para diferenciar "facturado" vs "efectivamente pagado" en el análisis de impacto) |

### 3.2 Tablas nuevas — esquema `administrativo`, prefijo obligatorio `negociacion_contratacion_`

| Tabla | Rol |
|---|---|
| `negociacion_contratacion_snapshot_tarifario` | Reemplaza el patrón "Excel histórico" por **snapshots versionados reales**: cada corte periódico (ej. mensual) del tarifario contratado queda congelado con `fecha_snapshot`, permitiendo series temporales año tras año, no solo "2025 vs 2026" hardcodeado. |
| `negociacion_contratacion_consumo_agregado` | Pre-agregación ETL de `rips_ap/am/at` por `prestador + codigo + periodo (mes/año) + tipo (CUPS/CUM/insumo)`: unidades, valor total, valor unitario promedio/mediana. Evita escanear 177M/81M/60M filas en cada consulta de dashboard. |
| `negociacion_contratacion_benchmark_mercado` | Precios de referencia externos (SISMED/datos.gov.co, manual tarifario ISS 2001, cotizaciones de otras EPS) cargados por ingesta batch, no por scraping en vivo. |
| `negociacion_contratacion_escenario` | Encabezado de una simulación de negociación: prestador/contrato objetivo, usuario, fecha, estado (borrador/en negociación/cerrado), meta de ahorro. |
| `negociacion_contratacion_escenario_detalle` | Líneas de la simulación: código, tarifa actual, tarifa propuesta, consumo proyectado, impacto estimado. |
| `negociacion_contratacion_ronda_negociacion` | Historial de ofertas/contraofertas por ronda dentro de un escenario — trazabilidad del proceso de negociación en sí. |
| `negociacion_contratacion_exclusion_calidad` | Evolución namespaced de "matriz de errores" (`tarifas_excluidas_auditoria`), para excluir registros atípicos del cálculo estadístico sin tocar el dato origen. |
| `negociacion_contratacion_usuario` | Usuarios del Área de Contratación con rol (analista, jefe de contratación, admin) — independiente de ARYUWIS. |
| `negociacion_contratacion_log_auditoria` | Auditoría de acciones (quién exportó qué, quién cambió un escenario) — obligatorio por ser información estratégica sensible. |
| `negociacion_contratacion_indicador_cache` | Cache de KPIs pesados del dashboard ejecutivo, refrescado por el ETL, para que el panel cargue en milisegundos en vez de recalcular en cada visita. |

Todas con `usuario_grabado`/`fecha_grabado` (consistencia con el resto del esquema) y claves foráneas explícitas donde aplique (a diferencia de varias tablas legadas del esquema que no las declaran).

### 3.3 Estrategia ETL (pieza nueva, no existía en el proyecto original)

Proceso batch (Route Handler `/api/etl/*` disparado por cron externo o botón manual de "Actualizar" en el panel admin) que:
1. Lee `rips_ap/am/at` del período faltante (incremental por `fecha_recepciona`, no full scan).
2. Aplica el matching prestador (4 estrategias) una sola vez por lote.
3. Escribe/actualiza `negociacion_contratacion_consumo_agregado`.
4. Toma un snapshot del tarifario vigente hacia `negociacion_contratacion_snapshot_tarifario` si hay cambios detectados (comparando contra el último snapshot).
5. Recalcula `negociacion_contratacion_indicador_cache`.

Todo transaccional (`BEGIN/COMMIT/ROLLBACK`), igual que el patrón ya validado en `insertHistoricoChunk`.

---

## 4. Módulos funcionales (mapeados a los objetivos del Área de Contratación)

| # | Módulo | Objetivo que cubre | Depende de |
|---|---|---|---|
| 1 | **Tarifario Vigente e Histórico** | Analizar tarifas históricas | Snapshot ETL (3.3) |
| 2 | **Comparativo entre Prestadores** | Comparar negociaciones entre prestadores, comportamiento CUPS/CUM, comparar medicamentos | Módulo 1 |
| 3 | **Consumo y Frecuencia** | Analizar consumos, analizar frecuencias | Consumo agregado ETL |
| 4 | **Sobrecostos y Oportunidades de Ahorro** | Detectar oportunidades de ahorro, identificar sobrecostos, analizar costos | Módulos 1 + 3 |
| 5 | **Simulador de Escenarios de Negociación** | Simular escenarios de negociación | Módulos 1 + 3 + 4 |
| 6 | **Benchmark de Mercado Externo** | Referencia objetiva para negociar (más allá de comparar contra sí mismo) | Ingesta batch propia |
| 7 | **Dashboard Ejecutivo / Indicadores Estratégicos** | Generar indicadores estratégicos, apoyar decisión pre-negociación | Todos los anteriores (consume cache) |
| 8 | **Administración (usuarios, auditoría, calidad de datos)** | Transversal — seguridad y gobernanza | — |

---

## 5. Estrategia de implementación incremental

Orden de construcción propuesto (cada módulo cerrado 100% —con su UI, sus Server Actions, sus pruebas manuales de datos reales— antes de pasar al siguiente):

**Fase 0 — Fundación (antes del Módulo 1):** scaffold Next.js 15, conexión a `db.ts`/proxy, middleware de sesión, layout base y `negociacion_contratacion_usuario` + login. Sin esto no hay dónde colgar ningún módulo.

**Fase 1 — Módulo Tarifario Vigente e Histórico.** Es la base de datos de todo lo demás: sin esto no hay con qué comparar. Incluye el primer job ETL de snapshot.

**Fase 2 — Módulo Comparativo entre Prestadores.** Reutiliza y limpia la lógica estadística validada del componente actual (media/mediana, semáforo, deduplicación por mejor precio).

**Fase 3 — Módulo Consumo y Frecuencia.** Introduce el ETL de agregación de RIPS (la pieza más pesada en términos de rendimiento).

**Fase 4 — Sobrecostos y Oportunidades de Ahorro.** Cruza Fases 1-3; aquí se corrige el umbral inconsistente del componente original (%, no pesos absolutos, configurable por tipo de código).

**Fase 5 — Simulador de Escenarios.** El módulo más nuevo (no existía nada parecido) — permite proponer una tarifa nueva y proyectar el impacto contra el consumo histórico antes de sentarse a negociar.

**Fase 6 — Benchmark de Mercado Externo.** Ingesta batch de SISMED/datos.gov.co u otras fuentes que el Área de Contratación indique.

**Fase 7 — Dashboard Ejecutivo.** Se construye al final porque consume/resume todos los módulos anteriores.

**Transversal, en paralelo desde la Fase 1:** auditoría y control de calidad de datos (exclusiones), manejo de errores, exportación Excel/PDF por módulo.

---

## 6. Principios no negociables (aplican a cada fase)

- **Solo lectura sobre las tablas SIE existentes** (`rips_*`, `ct_*`, `tb_*`). Toda escritura ocurre exclusivamente en tablas `negociacion_contratacion_*`.
- **Nunca `SELECT *` sobre `rips_ap/am/at`** sin filtro de período — mismo riesgo de timeout de gateway documentado en el proyecto base.
- **Parámetros posicionales siempre**, nunca interpolación de valores en SQL.
- **Todo umbral de negocio (variación %, ahorro mínimo, etc.) es configurable**, no hardcodeado — vive en `negociacion_contratacion_*` o en config, no en el componente.
- **Todo cálculo estadístico/financiero es una función pura en `src/lib/negociacion/`**, con pruebas unitarias — nunca inline en un componente `.tsx`.
- **Auditoría de todo cambio de escenario y toda exportación** — esta es información que se usa para negociar contratos multimillonarios; debe quedar trazado quién vio/exportó/simuló qué.

---

## 7. Decisiones confirmadas (2026-07-27)

| Punto | Decisión |
|---|---|
| Ubicación de tablas nuevas | Esquema `administrativo` (el mismo de todo el ecosistema SIE), tablas con prefijo `negociacion_contratacion_` |
| Autenticación | Cookie de sesión propia (mismo patrón middleware que Proyecto_Dusakawi) + tabla `negociacion_contratacion_usuario` real con hash de clave y roles (analista, jefe de contratación, admin) — sin credenciales hardcodeadas, sin NextAuth/Supabase Auth |
| Frecuencia de refresco ETL | Diaria (cron nocturno) para `negociacion_contratacion_consumo_agregado` y `negociacion_contratacion_snapshot_tarifario` |
| Alcance del Benchmark de Mercado Externo | Fuera del alcance inicial — se aborda en Fase 6, después de validar el núcleo (Fases 0-5) con el Área de Contratación |

Con esto, la Fase 0 (Fundación) queda lista para iniciar: scaffold Next.js 15, `db.ts`/proxy, middleware de sesión, tabla y login de `negociacion_contratacion_usuario`.
