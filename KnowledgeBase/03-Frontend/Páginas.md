---
tags: [frontend, paginas, rutas, app-router]
---

# Páginas

## Propósito
Inventariar las rutas del App Router de Next.js existentes y planificadas.

## Rutas implementadas

| Ruta | Archivo | Tipo | Protegida por middleware |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Server Component | No |
| `/login` | `src/app/login/page.tsx` | Server Component (envuelve `LoginForm` en `Suspense`) | No |
| `/dashboard` | `src/app/(protegido)/dashboard/page.tsx` | Server Component | Sí |
| `/tarifarios` | `src/app/(protegido)/tarifarios/page.tsx` | Server Component (lee `searchParams`) | Sí |
| `/tarifarios/[id]` | `src/app/(protegido)/tarifarios/[id]/page.tsx` | Server Component + `TarifarioDetalleClient` (Client Component) | Sí |

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
