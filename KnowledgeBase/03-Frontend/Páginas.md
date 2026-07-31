---
tags: [frontend, paginas, rutas, app-router]
---

# Páginas

## Propósito
Inventariar las rutas del App Router de Next.js existentes y planificadas.

> [!warning] Documento parcialmente desactualizado
> Este inventario no refleja todavía `/comparativo`, `/historico-prestador`, `/perfil-prestador`, `/consumo-frecuencia` ni `/top-impacto` (todos ✅ implementados según [[Arquitectura General#4. Módulos funcionales]] y [[Contratación]]) — quedó desactualizado desde la Fase 1. Se agrega aquí `/analisis-propuesta` (2026-07-31) sin reescribir el resto; pendiente una revisión completa de este documento.

## Rutas implementadas

| Ruta | Archivo | Tipo | Protegida por middleware |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Server Component | No |
| `/login` | `src/app/login/page.tsx` | Server Component (envuelve `LoginForm` en `Suspense`) | No |
| `/dashboard` | `src/app/(protegido)/dashboard/page.tsx` | Server Component | Sí |
| `/tarifarios` | `src/app/(protegido)/tarifarios/page.tsx` | Server Component (lee `searchParams`) | Sí |
| `/tarifarios/[id]` | `src/app/(protegido)/tarifarios/[id]/page.tsx` | Server Component + `TarifarioDetalleClient` (Client Component) | Sí |
| `/analisis-propuesta` | `src/app/(protegido)/analisis-propuesta/page.tsx` | Server Component + `AnalisisPropuestaClient` (Client Component) | Sí |
| `/precio-referencia-eps` | `src/app/(protegido)/precio-referencia-eps/page.tsx` | Server Component + `PrecioReferenciaEpsClient` (Client Component) | Sí |

### `/` — Landing pública
Página de bienvenida con logo (`ShieldCheck`), título, descripción y botón "Ingresar" hacia `/login`. Sin lógica de servidor.

### `/login`
Envuelve `LoginForm` en `<Suspense fallback={null}>` porque el formulario lee `useSearchParams()` (`callbackUrl`). Incluye texto de aviso: "Acceso exclusivo para personal autorizado del Área de Contratación."

### `/dashboard`
Obtiene la sesión (`getSession()`) y renderiza un saludo personalizado + grid de 6 tarjetas, una por cada módulo de análisis. La tarjeta de **Tarifario Vigente e Histórico** ya tiene badge "Disponible" y enlaza a `/tarifarios` (`Link` envolviendo la `Card`); las demás siguen con badge "Próximamente"/"Fase 6" y sin enlace.

### `/tarifarios` ✅
Server Component que lee `searchParams` (búsqueda, estado, tipoContrato, vigencia, page) y llama `listContratos()` + `getOpcionesFiltro()` en paralelo. Renderiza: barra de filtros (`FiltrosContrato`, Client Component que actualiza la URL con `router.push`, sin recarga completa), tabla de contratos con badge de vigencia/estado y de qué tarifarios tiene cada uno, y paginación server-side (`Paginacion`, modo enlace). Cada fila enlaza a `/tarifarios/[id]`.

### `/tarifarios/[id]` ✅
Server Component que resuelve `params` (Next 15: `params` y `searchParams` son `Promise`), llama `getContratoDetalle()` y `getConteosTarifario()`, y renderiza: encabezado con los 8 campos del contrato (número, prestador, NIT, vigencia, valor contratado, tipo de contratación, responsable), más `<TarifarioDetalleClient>` (Client Component) con las pestañas Procedimientos/Medicamentos/Insumos (siempre visibles) y Paquetes/Otros (solo si tienen registros). Cada pestaña usa `TablaTarifario` (búsqueda con debounce, paginación en cliente vía Server Action, export Excel/CSV/impresión) — no hay recarga de página al cambiar de pestaña, de página de resultados, ni al buscar.

### `/analisis-propuesta` ✅
Server Component simple (sin `searchParams`) que renderiza `<AnalisisPropuestaClient>`. El Client Component sube el archivo de propuesta (CSV/TXT/XLSX) y el municipio vía `FormData` a la Server Action `evaluarPropuestaPrestador` (a diferencia del resto de módulos, que invocan Server Actions con argumentos planos) — ver [[API#POST /api/export/analisis-propuesta ✅ Implementado (2026-07-31)]] y [[Contratación#Nuevo módulo: Análisis de Propuesta del Prestador (2026-07-31)]].

### `/precio-referencia-eps` ✅ (2026-07-31)
Server Component simple que renderiza `<PrecioReferenciaEpsClient>`. Primera pantalla del proyecto con capacidad de escritura desde la UI: sube un archivo (Nit_prestador, Prestador, Municipio, Codigo, Descripcion, Precio — precios que OTRAS EPS pagan, no un prestador de Dusakawi) vía `cargarPreciosReferenciaEps`, y además ofrece una tabla de consulta/depuración (filtros por municipio/EPS/código, borrado individual y borrado masivo por EPS+municipio) — ver [[API#Server Actions de "Precios de Referencia EPS" (2026-07-31)]] y [[Contratación#Módulo: Precios de Referencia de Otras EPS (2026-07-31)]].

## Grupo de rutas `(protegido)`

`src/app/(protegido)/layout.tsx` envuelve todas las páginas autenticadas: valida sesión (redundante con middleware, defensa en profundidad), renderiza header con nombre/rol del usuario y botón de logout.

## Rutas planificadas (no implementadas — protegidas de antemano en el matcher del middleware)

| Ruta | Módulo |
|---|---|
| `/comparativo` | Módulo 2 — Comparativo entre Prestadores |
| `/consumo` | Módulo 3 — Consumo y Frecuencia |
| `/sobrecostos` | Módulo 4 — Sobrecostos y Ahorro |
| `/simulador` | Módulo 5 — Simulador de Escenarios |
| `/benchmark` | Módulo 6 — Benchmark de Mercado Externo |
| `/admin` | Módulo 8 — Administración |

## Ver también
- [[Componentes]]
- [[Flujo Login]]
- [[Roadmap]]
