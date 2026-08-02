---
tags: [frontend, componentes, react]
---

# Componentes

## Propósito
Inventariar todos los componentes React existentes hoy en `src/components/`.

> [!info] Actualizado 2026-08-02
> El inventario creció de Fase 0 a 8 módulos en producción (4 originales + 4 nuevos) — ver [[Roadmap]] para el estado consolidado. Las secciones de Módulo 1 y "Componentes de aplicación" describen el estado más temprano; las secciones de Módulo 2 en adelante fueron agregadas en esta actualización.

## Componentes UI (Shadcn/Radix) — `src/components/ui/`

| Componente | Archivo | Líneas | Base |
|---|---|---:|---|
| `Badge` | `badge.tsx` | 29 | `class-variance-authority` |
| `Button` | `button.tsx` | 47 | `@radix-ui/react-slot` + `cva` |
| `Card` (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`) | `card.tsx` | 35 | Composición simple con `cn()` |
| `Input` | `input.tsx` | 22 | `<input>` estilizado |
| `Label` | `label.tsx` | 17 | `@radix-ui/react-label` |
| `Select` ✅ | `select.tsx` | — | `<select>` nativo estilizado (deliberadamente sin `@radix-ui/react-select`, para no sumar otra dependencia solo para filtros de una opción) |
| `Table` (+ `TableHeader/Row/Head/Body/Cell`) ✅ | `table.tsx` | — | Tailwind puro, sin dependencia nueva |
| `Tabs` (+ `TabsList/Trigger/Content`) ✅ | `tabs.tsx` | — | `@radix-ui/react-tabs` |

Son los primitivos estándar de Shadcn UI, copiados sin modificaciones sustanciales del resto del ecosistema Dusakawi (mismo design system, para que el equipo no reaprenda nada — ver [[Tecnologías]]).

## Componentes de aplicación

### `LogoutButton`
- **Archivo**: `src/components/logout-button.tsx`.
- **Tipo**: Client Component (`"use client"`).
- **Propósito**: botón que ejecuta `logoutAction()`, redirige a `/login` y refresca el router.
- **Dependencias**: `useTransition` (estado de carga), `useRouter`, `Button` (UI), `logoutAction`.
- **Estados**: `isPending` (muestra ícono `Loader2` girando mientras se ejecuta el logout).

```tsx
const handleLogout = () => {
  startTransition(async () => {
    await logoutAction();
    router.push("/login");
    router.refresh();
  });
};
```

### `LoginForm`
- **Archivo**: `src/app/login/login-form.tsx`.
- **Tipo**: Client Component.
- **Propósito**: formulario de usuario/clave que invoca `loginAction`.
- **Dependencias**: `useState` (username, password, error), `useTransition`, `useRouter`, `useSearchParams`, componentes `Card`/`Input`/`Label`/`Button`.
- **Flujo**: ver [[Flujo Login]].
- **Nota de diseño**: no usa `react-hook-form` ni `zod` pese a estar instalados como dependencia — validación actual es solo `required` de HTML + chequeo de vacíos en el servidor (`loginAction`). Ver [[Problemas Comunes]] y oportunidad en [[Mejoras]].

## Componentes del Módulo 1 — `src/components/tarifarios/` ✅

| Componente | Archivo | Tipo | Propósito |
|---|---|---|---|
| `FiltrosContrato` | `filtros-contrato.tsx` | Client | Búsqueda con debounce + selects de vigencia/estado/tipo de contratación; actualiza la URL (`router.push`) sin recarga completa |
| `Paginacion` | `paginacion.tsx` | Client | Control reutilizable con **dos modos**: `baseHref`+`queryParams` (datos planos, para páginas Server Component — nunca una función, no es serializable por el RSC boundary) o `onPageChange` (callback, para estado en cliente) |
| `TablaTarifario<T>` | `tabla-tarifario.tsx` | Client, genérico | Tabla reutilizada por las 5 pestañas del detalle: búsqueda con debounce, paginación server-side vía Server Action, botones Excel/CSV/Imprimir. Parametrizada por `cargarPagina` (la Server Action) y `columnas` |
| `TarifarioDetalleClient` | `tarifario-detalle-client.tsx` | Client | Orquesta las 5 pestañas (`Tabs` de Radix) sobre `TablaTarifario`, con las columnas específicas de cada tipo |

> [!note] Por qué `Paginacion` no acepta una función como prop
> Un intento inicial pasaba `hrefForPage: (page) => string` desde el Server Component `/tarifarios/page.tsx` — Next.js falló con *"Functions cannot be passed directly to Client Components"*. Los Server Components solo pueden pasar props serializables a un Client Component; se corrigió pasando `baseHref` (string) + `queryParams` (objeto plano) y armando el `href` **dentro** del Client Component.

## Componentes del Módulo 2 — `src/components/comparativo/` ✅

| Componente | Archivo | Tipo | Propósito |
|---|---|---|---|
| `ComparativoClient` | `comparativo-client.tsx` | Client | Orquesta las pestañas "Comparativo por municipio"/"Buscar código", panel de umbrales del semáforo, filtro multi-selección por estado, selector Promedio/Mediana, exportación Excel/CSV |
| `DashboardRiesgoTab` | `dashboard-riesgo-tab.tsx` | Client | Pestaña "Dashboard Analítico de Riesgo Contractual" (Fase A) — KPIs, ranking de riesgo, heatmap por municipio, Top 20, modales de doble clic con la fuente de cada KPI (`TablaFuenteKpi`) |
| `semaforo-ui.tsx` | `semaforo-ui.tsx` | — (helpers de UI) | `FiltroEstadosSemaforo`/`colorSemaforo`/`ESTADOS_SEMAFORO`, extraídos de `comparativo-client.tsx` para reutilizar en Módulo 3 |

> [!warning] Archivo de alto riesgo de edición
> `comparativo-client.tsx` es grande y tiene historial de corrupción por bytes NUL al editarlo (ver [[Problemas Comunes]]/[[Soluciones]]) — por eso el Dashboard de Riesgo se aisló en su propio archivo (`dashboard-riesgo-tab.tsx`) en vez de crecer dentro del mismo componente.

## Componentes del Módulo 3 — `src/components/historico-prestador/` ✅

| Componente | Archivo | Tipo | Propósito |
|---|---|---|---|
| `HistoricoPrestadorClient` | `historico-prestador-client.tsx` | Client | Selección de prestador, tabla comparativa 2025 vs. vigente, `GraficoPuntos` (SVG propio, sin `recharts`), KPIs con segmentadores clicables, sub-segmentador subieron/bajaron/igual, paginación de 100 |

## Componentes del Módulo 4 — `src/components/consumo-frecuencia/` ✅

| Componente | Archivo | Tipo | Propósito |
|---|---|---|---|
| `ConsumoFrecuenciaClient` | `consumo-frecuencia-client.tsx` | Client | Selector de prestador + 2 `<input type="date">` (Desde/Hasta, tope 92 días), KPIs, tabla ordenable por código |

## Componentes de "Perfil Competitivo del Prestador" — `src/components/perfil-prestador/` ✅

| Componente | Archivo | Tipo | Propósito |
|---|---|---|---|
| `PerfilPrestadorClient` | `perfil-prestador-client.tsx` | Client | Resumen ejecutivo, acordeón por código (`FilaCodigoPerfilRow`) con pares del municipio, tooltips explicativos, modal de ranking completo, botón "Ver movimientos RIPS" por prestador (modal factura por factura) |

## Componentes de "Análisis de Códigos de Mayor Impacto Económico" — `src/components/top-impacto/` ✅

| Componente | Archivo | Tipo | Propósito |
|---|---|---|---|
| `TopImpactoClient` | `top-impacto-client.tsx` | Client | Filtros combinables con selector en cascada Prestador→Contrato(s)→Municipio, 3 gráficos de barras HTML/CSS (sin librería de terceros), tabla Top 100 ordenable/paginada de a 25, drill-down de 3 niveles (`abrirDrillPrestador`) |

## Componentes de "Análisis de Propuesta del Prestador" — `src/components/analisis-propuesta/` ✅

| Componente | Archivo | Tipo | Propósito |
|---|---|---|---|
| `AnalisisPropuestaClient` | `analisis-propuesta-client.tsx` | Client | Sube archivo de propuesta (CSV/TXT/XLSX) vía `FormData`, `construirFilasAcordeon()` fusiona prestadores reales + fila sintética de la propuesta, descarga de "Contrapropuesta" con columnas dinámicas vía `fetch`+`blob` (único módulo del proyecto con descarga `POST`) |

## Componentes de "Precios de Referencia de Otras EPS" — `src/components/precio-referencia-eps/` ✅

| Componente | Archivo | Tipo | Propósito |
|---|---|---|---|
| `PrecioReferenciaEpsClient` | `precio-referencia-eps-client.tsx` | Client | Carga de archivo (Nit/Prestador/Municipio/Codigo/Descripcion/Precio de otras EPS), tabla de consulta/depuración con filtros y borrado, banner + botón "Aplicar migración" (solo rol `admin`) si la tabla `negociacion_contratacion_precio_referencia_eps` aún no existe |

## Componentes planificados (no existen aún)

Según `docs/ARQUITECTURA.md` §2.3, cuando se construyan los módulos restantes existirán carpetas `components/simulador/`, `components/benchmark/`, `components/admin/` — ninguna existe todavía.

## Diagrama de composición actual

```mermaid
graph TD
    RootLayout["layout.tsx (root)"] --> HomePage["page.tsx (landing)"]
    RootLayout --> LoginPage["login/page.tsx"]
    LoginPage --> LoginForm
    RootLayout --> ProtegidoLayout["(protegido)/layout.tsx"]
    ProtegidoLayout --> LogoutButton
    ProtegidoLayout --> DashboardPage["(protegido)/dashboard/page.tsx"]

    LoginForm --> UI_Card[Card]
    LoginForm --> UI_Input[Input]
    LoginForm --> UI_Label[Label]
    LoginForm --> UI_Button[Button]
    LogoutButton --> UI_Button
    DashboardPage --> UI_Card
    DashboardPage --> UI_Badge[Badge]
```

## Problemas conocidos
- Ninguno bloqueante — inventario pequeño y estable.

## Posibles mejoras
- Migrar `LoginForm` a `react-hook-form` + `zod` (ya están instalados) para validación de cliente más robusta y consistente con el resto del ecosistema.
- Extraer las tarjetas de módulo del dashboard a un componente `ModuloCard` reutilizable cuando se agregue contenido dinámico real.

## Ver también
- [[Páginas]]
- [[Estados]]
- [[Hooks]]
