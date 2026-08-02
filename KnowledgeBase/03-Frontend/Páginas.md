---
tags: [frontend, paginas, rutas, app-router]
---

# Páginas

## Propósito
Inventariar las rutas del App Router de Next.js existentes y planificadas.

> [!info] Actualizado 2026-08-02
> Reescrito completo — la versión anterior no reflejaba `/comparativo`, `/historico-prestador`, `/perfil-prestador`, `/consumo-frecuencia` ni `/top-impacto` desde la Fase 1. Fuente de verdad para el estado de cada módulo: [[Contratación]] y [[API]].

## Rutas implementadas

| Ruta | Archivo | Tipo | Protegida por middleware |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Server Component | No |
| `/login` | `src/app/login/page.tsx` | Server Component (envuelve `LoginForm` en `Suspense`) | No |
| `/dashboard` | `src/app/(protegido)/dashboard/page.tsx` | Server Component | Sí |
| `/tarifarios` | `src/app/(protegido)/tarifarios/page.tsx` | Server Component (lee `searchParams`) | Sí |
| `/tarifarios/[id]` | `src/app/(protegido)/tarifarios/[id]/page.tsx` | Server Component + `TarifarioDetalleClient` (Client Component) | Sí |
| `/comparativo` | `src/app/(protegido)/comparativo/page.tsx` | Server Component + `ComparativoClient` (Client Component) | Sí |
| `/historico-prestador` | `src/app/(protegido)/historico-prestador/page.tsx` | Server Component + `HistoricoPrestadorClient` (Client Component) | Sí |
| `/perfil-prestador` | `src/app/(protegido)/perfil-prestador/page.tsx` | Server Component + `PerfilPrestadorClient` (Client Component) | Sí |
| `/consumo-frecuencia` | `src/app/(protegido)/consumo-frecuencia/page.tsx` | Server Component + `ConsumoFrecuenciaClient` (Client Component) | Sí |
| `/top-impacto` | `src/app/(protegido)/top-impacto/page.tsx` | Server Component + `TopImpactoClient` (Client Component). Declara `export const dynamic = "force-dynamic"` y `export const maxDuration = 120` — ver [[Problemas Comunes#5b. Caso real confirmado: Top Impacto congelado en 92%]] | Sí |
| `/analisis-propuesta` | `src/app/(protegido)/analisis-propuesta/page.tsx` | Server Component + `AnalisisPropuestaClient` (Client Component) | Sí |
| `/precio-referencia-eps` | `src/app/(protegido)/precio-referencia-eps/page.tsx` | Server Component + `PrecioReferenciaEpsClient` (Client Component) | Sí |

### `/` — Landing pública
Página de bienvenida con logo (`ShieldCheck`), título, descripción y botón "Ingresar" hacia `/login`. Sin lógica de servidor.

### `/login`
Envuelve `LoginForm` en `<Suspense fallback={null}>` porque el formulario lee `useSearchParams()` (`callbackUrl`). Incluye texto de aviso: "Acceso exclusivo para personal autorizado del Área de Contratación."

### `/dashboard`
Obtiene la sesión (`getSession()`) y renderiza un saludo personalizado + grid de tarjetas de módulo. Las tarjetas de los módulos ya implementados enlazan con `Link` a su ruta real; las de Simulador/Benchmark/Administración siguen con badge "Próximamente"/"Fase 6" y sin enlace.

### `/tarifarios` ✅
Server Component que lee `searchParams` (búsqueda, estado, tipoContrato, vigencia, page) y llama `listContratos()` + `getOpcionesFiltro()` en paralelo. Renderiza: barra de filtros (`FiltrosContrato`, Client Component que actualiza la URL con `router.push`, sin recarga completa), tabla de contratos con badge de vigencia/estado y de qué tarifarios tiene cada uno, y paginación server-side (`Paginacion`, modo enlace). Cada fila enlaza a `/tarifarios/[id]`.

### `/tarifarios/[id]` ✅
Server Component que resuelve `params` (Next 15: `params` y `searchParams` son `Promise`), llama `getContratoDetalle()` y `getConteosTarifario()`, y renderiza: encabezado con los 8 campos del contrato (número, prestador, NIT, vigencia, valor contratado, tipo de contratación, responsable), más `<TarifarioDetalleClient>` (Client Component) con las pestañas Procedimientos/Medicamentos/Insumos (siempre visibles) y Paquetes/Otros (solo si tienen registros). Cada pestaña usa `TablaTarifario` (búsqueda con debounce, paginación en cliente vía Server Action, export Excel/CSV/impresión) — no hay recarga de página al cambiar de pestaña, de página de resultados, ni al buscar.

### `/comparativo` ✅
`ComparativoClient` con 2 pestañas ("Comparativo por municipio" y "Buscar código específico") más una 3ª pestaña "Dashboard Analítico de Riesgo Contractual" (Fase A, agregada 2026-07-29: KPIs, ranking de riesgo con score 0-100, heatmap por municipio, Top 20, ahorro potencial, narrativa). Panel de umbrales del semáforo configurable en pantalla, selector "Comparar contra: Promedio/Mediana", filtro multi-selección por estado de semáforo, y exportación Excel/CSV vía `/api/export/comparativo`. Ver reglas completas en [[Contratación#Reglas implementadas — Módulo 2 (Comparativo entre Prestadores) ✅]].

### `/historico-prestador` ✅
`HistoricoPrestadorClient`: selección de prestador, tabla comparativa (2 puntos: foto `historico_tarifas_2025` vs. tarifa vigente hoy) con variación %, gráfico SVG propio de evolución, KPIs con segmentadores clicables (comparados/nuevos/eliminados, y sub-segmentador subieron/bajaron/igual), export Excel/CSV vía `/api/export/historico-prestador`. Ver [[Contratación#Reglas implementadas — Módulo 3 (Comparativo Histórico del Prestador) ✅ MVP]].

### `/perfil-prestador` ✅
`PerfilPrestadorClient`: selección de tipo de tarifario y luego prestador; resumen ejecutivo (score, ranking, costo potencial), tabla de todos sus códigos con acordeón mostrando sus pares del mismo municipio, botón "Ver movimientos RIPS" por prestador del acordeón (factura por factura, acotado a la vigencia del contrato), export Excel/CSV vía `/api/export/perfil-prestador`. Ver [[Contratación#Perfil Competitivo del Prestador — nueva tarjeta independiente del dashboard (2026-07-29)]].

### `/consumo-frecuencia` ✅
`ConsumoFrecuenciaClient`: selector de prestador + rango de fechas día-a-día (tope de seguridad 92 días), consulta en vivo de `rips_ap/am/at` filtrando primero `rips_af` por prestador+rango, KPIs y tabla ordenable por código, export Excel/CSV vía `/api/export/consumo-frecuencia`. Ver [[Contratación#Reglas implementadas — Módulo 4 (Consumo y Frecuencia) ✅ MVP]].

### `/top-impacto` ✅
`TopImpactoClient`: ranking Top 100 EPS-completa por valor radicado (procedimientos+medicamentos+insumos+consultas), filtros combinables (tipo/año/prestador/municipio/contrato) con selector en cascada Prestador→Contrato(s)→Municipio, 3 gráficos de barras (Top 20 código/prestador/municipio), drill-down de 3 niveles (barra de prestador → códigos del prestador → facturas del código), export Excel/CSV vía `/api/export/top-impacto`. Ver [[Contratación#Nuevo módulo: Análisis de Códigos de Mayor Impacto Económico (2026-07-29)]].

### `/analisis-propuesta` ✅
Server Component simple (sin `searchParams`) que renderiza `<AnalisisPropuestaClient>`. El Client Component sube el archivo de propuesta (CSV/TXT/XLSX) y el municipio vía `FormData` a la Server Action `evaluarPropuestaPrestador` (a diferencia del resto de módulos, que invocan Server Actions con argumentos planos) — ver [[API#POST /api/export/analisis-propuesta ✅ Implementado (2026-07-31)]] y [[Contratación#Nuevo módulo: Análisis de Propuesta del Prestador (2026-07-31)]].

### `/precio-referencia-eps` ✅ (2026-07-31)
Server Component simple que renderiza `<PrecioReferenciaEpsClient>`. Primera pantalla del proyecto con capacidad de escritura desde la UI: sube un archivo (Nit_prestador, Prestador, Municipio, Codigo, Descripcion, Precio — precios que OTRAS EPS pagan, no un prestador de Dusakawi) vía `cargarPreciosReferenciaEps`, y además ofrece una tabla de consulta/depuración (filtros por municipio/EPS/código, borrado individual y borrado masivo por EPS+municipio) — ver [[API#Server Actions de "Precios de Referencia EPS" (2026-07-31)]] y [[Contratación#Módulo: Precios de Referencia de Otras EPS (2026-07-31)]].

## Grupo de rutas `(protegido)`

`src/app/(protegido)/layout.tsx` envuelve todas las páginas autenticadas: valida sesión (redundante con middleware, defensa en profundidad), renderiza header con nombre/rol del usuario y botón de logout.

## Rutas planificadas (no implementadas — protegidas de antemano en el matcher del middleware)

| Ruta | Módulo |
|---|---|
| `/simulador` | Módulo 5 — Simulador de Escenarios |
| `/benchmark` | Módulo 6 — Benchmark de Mercado Externo |
| `/admin` | Módulo 8 — Administración |

## Ver también
- [[Componentes]]
- [[Flujo Login]]
- [[Roadmap]]
- [[Contratación]]
- [[API]]
