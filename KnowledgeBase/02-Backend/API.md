---
tags: [backend, api]
---

# API

> [!warning] Estado actual
> El proyecto tiene 5 **Route Handlers reales**: `GET /api/export/tarifario` (Módulo 1), `GET /api/export/comparativo` (Módulo 2), `GET /api/export/historico-prestador` (Módulo 3), `GET /api/export/consumo-frecuencia` (Módulo 4) y `GET /api/export/perfil-prestador` (Perfil Competitivo del Prestador), todos exportación binaria Excel/CSV. El resto de operaciones de lectura/escritura sigue pasando por **Server Actions** (ver [[Servicios]]), siguiendo la convención: Server Actions para todo lo que no sea un archivo binario, Route Handlers solo para descargas. Este documento describe tanto lo existente como el diseño planificado en `docs/ARQUITECTURA.md` §2.3.

## Por qué Server Actions y no solo API REST

El stack usa **Server Actions para mutaciones desde componentes** y reserva **Route Handlers (`route.ts`)** para: endpoints consumidos por el propio frontend vía `fetch`, exportaciones binarias (Excel/PDF), o integraciones externas. Hoy solo existe el primer caso, implementado como Server Action.

## `GET /api/export/tarifario` ✅ Implementado

- **Archivo**: `src/app/api/export/tarifario/route.ts`.
- **Por qué Route Handler y no Server Action**: el resultado es un archivo binario que el navegador debe descargar (`Content-Disposition: attachment`) — las Server Actions no están pensadas para esto.
- **Query params**: `contrato` (consecutivo del contrato), `tipo` (`servicios`|`otros`|`medicamentos`|`insumos`|`paquetes`), `formato` (`xlsx`|`csv`), `busqueda` (opcional, mismo filtro que la tabla en pantalla).
- **Implementación**: reutiliza las mismas Server Actions de lectura (`getTarifarioServicios`, etc.) con `pageSize = LIMITE_FILAS_EXPORTACION` (20.000 filas) para traer todo el resultado filtrado en una sola pasada, y construye el archivo con `construirCsv`/`construirLibroExcel` de `src/lib/negociacion/exportar.ts` (no duplica lógica de negocio ni de acceso a datos).
- **CSV**: separador `;` + BOM UTF-8 (para que Excel en Windows no corrompa tildes/Ñ — mismo criterio documentado en el ecosistema Dusakawi para otros exports).
- **Excel**: vía `exceljs`, con encabezado en negrita, autofiltro y formato de columna (moneda/porcentaje/fecha) según el tipo de dato.

## `GET /api/export/comparativo` ✅ Implementado

- **Archivo**: `src/app/api/export/comparativo/route.ts`.
- **Por qué Route Handler y no Server Action**: mismo motivo que el export de Módulo 1 — archivo binario para descarga (`Content-Disposition: attachment`).
- **Query params**: `modo` (`municipio`|`codigo`), `tipo` (`servicios`|`medicamentos`|`insumos`), `municipio` (código, obligatorio si `modo=municipio`), `busqueda` (código/descripción; obligatorio si `modo=codigo`, opcional como filtro adicional si `modo=municipio`), `referencia` (`promedio`|`mediana`), `alertaPct`/`criticoPct` (umbrales del semáforo), `estados` (lista separada por comas de `NivelSemaforo`: `ok,alerta,critico,favorable,muyFavorable` — opcional, sin filtro si se omite), `formato` (`xlsx`|`csv`).
- **Implementación**: reutiliza `getComparativoMunicipioCompleto()` (modo municipio) o `getComparativoPorCodigo()` + `filtrarYRecortarPorEstados()` (modo código) de `src/app/actions/comparativo-actions.ts` — nunca recalcula filtros ni clasificación de semáforo por su cuenta; usa `etiquetaNivelSemaforo()`/`clasificarSemaforo()` de `src/lib/negociacion/comparativo.ts` como única fuente de verdad, igual que la UI.
- **Excel**: 3 hojas vía `crearLibroExcel()` + `agregarHojaExcel()` (`src/lib/negociacion/exportar.ts`) — "Parámetros" (con qué filtros se generó), "Resumen por código" (estadísticas agregadas), "Detalle por prestador" (una fila por prestador+código, con su semáforo en texto).
- **CSV**: solo la hoja de detalle por prestador, mismo criterio `;` + BOM UTF-8 que el resto del ecosistema.
- **Consumido desde**: botones "Informe Excel"/"CSV" en `src/components/comparativo/comparativo-client.tsx` (ambas pestañas), armando la URL con los filtros activos en pantalla en ese momento. Ver detalle completo en [[Contratación#Exportación — "Informe completo" para el analista de contratación]].

## `GET /api/export/historico-prestador` ✅ Implementado

- **Archivo**: `src/app/api/export/historico-prestador/route.ts`.
- **Query params**: `nit` (obligatorio), `alertaPct`/`criticoPct` (umbrales del semáforo), `tipo` (`servicios`|`medicamentos`|`insumos`|`otros`, opcional), `estados` (lista separada por comas, opcional), `segmento` (`comparados`|`nuevos`|`eliminados`, opcional — agregado 2026-07-29 junto con los segmentadores clicables en la UI), `direccion` (`subieron`|`bajaron`|`igual`, opcional — sub-segmentador dentro de `comparados`, agregado el mismo día), `formato` (`xlsx`|`csv`).
- **Implementación**: llama a `getHistoricoPrestador(nit, umbrales)` (`src/app/actions/historico-prestador-actions.ts`) — la misma Server Action que usa la UI, ya trae TODO el resultado sin paginar — y aplica los mismos filtros de tipo/estado que el usuario tenga activos en pantalla.
- **Excel**: 2 hojas — "Parámetros" y "Detalle por código" (a diferencia del Módulo 2, aquí una fila ya ES un código, no hay lista de prestadores anidada, así que no hace falta una hoja de "resumen" separada).
- Ver detalle completo de las decisiones de negocio detrás de este módulo en [[Contratación#Reglas implementadas — Módulo 3 (Comparativo Histórico del Prestador) ✅ MVP]].

## `GET /api/export/consumo-frecuencia` ✅ Implementado

- **Archivo**: `src/app/api/export/consumo-frecuencia/route.ts`.
- **Query params**: `codigoPrestador` (obligatorio, el `codigo_prestador` de `ct_ips`), `mes`/`anio` (obligatorios, un mes específico), `tipo` (`servicios`|`medicamentos`|`insumos`, opcional), `formato` (`xlsx`|`csv`).
- **Implementación**: llama a `getConsumoPrestador(codigoPrestador, mes, anio)` (`src/app/actions/consumo-frecuencia-actions.ts`), que filtra `rips_af` por prestador+mes (Seq Scan de ~6-8s, tabla más pequeña de las RIPS) y desde ahí cruza por `consecutivo_rips` (indexado) contra `rips_ap`/`rips_am`/`rips_at` — ver detalle completo y hallazgo de rendimiento en [[Contratación#Reglas implementadas — Módulo 4 (Consumo y Frecuencia) ✅ MVP]].
- **Excel**: 2 hojas — "Parámetros" y "Consumo por código".
- Por diseño, **no acepta rango de fechas abierto** — solo un mes a la vez, para no arriesgar timeout del proxy sobre tablas de cientos de millones de filas sin índice de fecha.

## `GET /api/export/perfil-prestador` ✅ Implementado

- **Archivo**: `src/app/api/export/perfil-prestador/route.ts`.
- **Query params**: `ips` (obligatorio), `tipo` (`servicios`|`medicamentos`|`insumos`, por defecto `servicios`), `referencia` (`promedio`|`mediana`), `alertaPct`/`criticoPct`, `nivel` (`NivelSemaforo` opcional, filtra el detalle a un solo estado), `formato` (`xlsx`|`csv`).
- **Implementación**: llama a `getPerfilPrestador(ips, tipo, referencia, umbrales)` (la misma Server Action que usa la UI) y exporta `resultado.codigos` (sin acotar). 2 hojas en Excel — "Parámetros" (incluye score de riesgo y posición en el ranking) y "Detalle por código".
- Ver detalle completo de la metodología en [[Contratación#Perfil Competitivo del Prestador — nueva tarjeta independiente del dashboard (2026-07-29)]].

## Server Actions de "Perfil Competitivo del Prestador" — nueva tarjeta independiente del Módulo 2

- **Archivo**: `src/app/actions/perfil-prestador-actions.ts`. Solo lectura.

| Server Action | Propósito |
|---|---|
| `getPerfilPrestador(ips, tipo, referencia, umbrales)` | Perfil completo de UN prestador: resumen ejecutivo (score/ranking/costo potencial, reutilizando `construirDashboardRiesgo`), posición en el ranking global, y el detalle código por código (sin acotar) contra sus pares del mismo municipio |

Reutiliza `construirGruposTodosMunicipios` y `getOpcionesPrestadoresRiesgo` (ambas exportadas de `dashboard-riesgo-actions.ts` para esta reutilización) — no duplica ninguna consulta SQL. Ver metodología completa en [[Contratación#Perfil Competitivo del Prestador — nueva tarjeta independiente del dashboard (2026-07-29)]].

## Endpoints planificados (aún no implementados)

| Ruta | Propósito | Módulo |
|---|---|---|
| `POST /api/etl/*` | Disparo de refresco ETL (cron externo o botón manual "Actualizar") | Transversal — ver [[Arquitectura General#3. Estrategia ETL]] |
| `GET /api/export/*` (otros módulos) | Descargas Excel/PDF de reportes de Módulos 3+ | Transversal |

## "Endpoint" actual: Server Action de autenticación

Aunque no es un endpoint HTTP en el sentido REST, `loginAction` y `logoutAction` cumplen ese rol funcionalmente. Documentado con el mismo nivel de detalle que un endpoint REST para facilitar la migración futura si se decide exponerlo como `route.ts`:

### `loginAction(username, password)`

- **Tipo**: Server Action (`"use server"`), invocada desde [[Componentes#LoginForm|LoginForm]].
- **Archivo**: `src/app/actions/auth-actions.ts`.
- **Autenticación requerida**: No (es el propio mecanismo de login).
- **Parámetros**:

| Parámetro | Tipo | Obligatorio | Validación |
|---|---|---|---|
| `username` | `string` | Sí | `trim()`, no vacío |
| `password` | `string` | Sí | No vacío |

- **Request** (invocación desde cliente): `loginAction(username, password)`.
- **Response**: `{ success: boolean; error?: string }`.
- **Códigos de error (mensajes de negocio, no HTTP)**:

| Caso | Mensaje |
|---|---|
| Usuario o clave vacíos | "Usuario y clave son obligatorios." |
| Falla de conexión a BD / tabla no existe | "No fue posible validar las credenciales (la tabla de usuarios aún no existe o el proxy no está disponible). Verifique que la migración 001 haya sido aplicada." |
| Usuario no encontrado o clave incorrecta | "Usuario o clave incorrectos." |
| Usuario inactivo (`activo != 1`) | "El usuario existe pero está inactivo. Contacte al administrador." |

- **Efectos secundarios**: crea cookie de sesión (`createSession`), actualiza `ultimo_login` (no bloqueante si falla).
- **Ejemplo de uso**:

```ts
const result = await loginAction("jperez", "claveSegura123");
if (result.success) {
  router.push("/dashboard");
} else {
  setError(result.error);
}
```

### `logoutAction()`

- **Tipo**: Server Action.
- **Parámetros**: ninguno.
- **Efecto**: destruye la cookie de sesión (`destroySession`).
- **Response**: `void`.

## Server Actions del Módulo 1 — Tarifarios ✅

- **Archivo**: `src/app/actions/tarifario-actions.ts`. Todas de **solo lectura** (ningún `INSERT`/`UPDATE`/`DELETE`).

| Server Action | Propósito | Paginación |
|---|---|---|
| `listContratos(filtros)` | Lista contratos con búsqueda (número/razón social/NIT), filtro de estado/tipo de contratación/vigencia | Server-side, `COUNT(*) OVER()` + `LIMIT/OFFSET` |
| `getContratoDetalle(consecutivoContrato)` | Encabezado del contrato para la página de detalle | — |
| `getConteosTarifario(consecutivoContrato)` | Cuenta filas por pestaña (Procedimientos/Medicamentos/Insumos/Paquetes/Otros) — decide qué pestañas mostrar | — |
| `getTarifarioServicios/Otros/Medicamentos/Insumos/Paquetes(consecutivoContrato, params)` | Filas paginadas y buscables de cada pestaña | Server-side |
| `getOpcionesFiltro()` | Opciones para los `<select>` de filtro (estados y tipos de contrato realmente usados) | — |

Se invocan **directamente desde Client Components** (`src/components/tarifarios/tabla-tarifario.tsx`, `tarifario-detalle-client.tsx`) vía RPC de Next.js — permite cambiar de pestaña, página o buscar sin recargar la página completa, sin necesitar TanStack Query ni una API REST intermedia.

## Server Actions del Dashboard Analítico de Riesgo Contractual (Fase A) — pestaña nueva del Módulo 2

- **Archivo**: `src/app/actions/dashboard-riesgo-actions.ts`. Solo lectura.

| Server Action | Propósito |
|---|---|
| `getDashboardRiesgoContractual(tipo, filtros)` | KPIs/ranking/heatmap/Top20/ahorro/narrativa, agregando el tarifario de un tipo a través de TODOS los municipios (no una fuente nueva — misma query base que `getComparativoPorCodigo`, sin filtro de municipio) |
| `getOpcionesTipoContrato()` | Opciones del filtro "Tipo de contrato" (Capitado/Evento/PGP) |
| `getOpcionesNivelComplejidad()` | Opciones del filtro "Nivel de complejidad" (0-3, sin catálogo en BD — etiquetas estándar del sistema de salud colombiano) |
| `getOpcionesPrestadoresRiesgo(tipo)` | Opciones del filtro "Prestador" |

Ver metodología completa (score de riesgo, ahorro potencial, hallazgo de qué segmentadores adicionales son viables) en [[Contratación#Dashboard Analítico de Competitividad y Riesgo Contractual (Fase A) — nueva pestaña del Módulo 2]].

## Ver también
- [[Servicios]]
- [[Autenticación]]
- [[Controladores]]
- [[Contratación]]
