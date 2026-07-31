---
tags: [backend, api]
---

# API

> [!warning] Estado actual
> El proyecto tiene 7 **Route Handlers reales**: `GET /api/export/tarifario` (Módulo 1), `GET /api/export/comparativo` (Módulo 2), `GET /api/export/historico-prestador` (Módulo 3), `GET /api/export/consumo-frecuencia` (Módulo 4), `GET /api/export/perfil-prestador` (Perfil Competitivo del Prestador), `GET /api/export/top-impacto` (Análisis de Códigos de Mayor Impacto Económico) y `POST /api/export/analisis-propuesta` (Análisis de Propuesta del Prestador — el único `POST`, ver más abajo), todos exportación binaria Excel/CSV. El resto de operaciones de lectura/escritura sigue pasando por **Server Actions** (ver [[Servicios]]), siguiendo la convención: Server Actions para todo lo que no sea un archivo binario, Route Handlers solo para descargas. Este documento describe tanto lo existente como el diseño planificado en `docs/ARQUITECTURA.md` §2.3.

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
- **Query params**: `codigoPrestador` (obligatorio, el `codigo_prestador` de `ct_ips`), `fechaInicio`/`fechaFin` (obligatorios, ISO `YYYY-MM-DD`, ambos extremos inclusive — reemplazó `mes`/`anio` el 2026-07-30), `tipo` (`servicios`|`medicamentos`|`insumos`, opcional), `formato` (`xlsx`|`csv`).
- **Implementación**: valida el rango con `validarRangoConsumo()` (`src/lib/negociacion/consumo-frecuencia.ts`, 400 si falla) y llama a `getConsumoPrestador(codigoPrestador, fechaInicio, fechaFin)` (`src/app/actions/consumo-frecuencia-actions.ts`), que filtra `rips_af` por prestador+rango (Seq Scan de costo ~constante independiente del ancho del rango, tabla más pequeña de las RIPS) y desde ahí cruza por `consecutivo_rips` (indexado) contra `rips_ap`/`rips_am`/`rips_at` — ver detalle completo y hallazgo de rendimiento en [[Contratación#Reglas implementadas — Módulo 4 (Consumo y Frecuencia) ✅ MVP]].
- **Excel**: 2 hojas — "Parámetros" y "Consumo por código".
- Por diseño, el rango tiene un **tope de seguridad de `MAX_DIAS_RANGO_CONSUMO` = 92 días (~3 meses)** — corregido 2026-07-30 (antes era exactamente "un mes, sin excepción"; se amplió a un rango libre acotado tras pedido del usuario, ver [[Contratación#Corrección 2026-07-30 — selector de mes único reemplazado por rango de fechas día-a-día, con tope de seguridad]]) — para no arriesgar timeout del proxy sobre tablas de cientos de millones de filas sin índice de fecha.

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

## `GET /api/export/top-impacto` ✅ Implementado

- **Archivo**: `src/app/api/export/top-impacto/route.ts`.
- **Query params**: `tipo` (`todos`|`servicios`|`medicamentos`|`insumos`, por defecto `todos`), `anio` (obligatorio en la práctica, por defecto el año actual), `ips`/`municipioCodigo`/`numerosContrato` (opcionales, combinables entre sí — `numerosContrato` es una lista separada por comas desde 2026-07-30, reemplazó al `numeroContrato` único), `formato` (`xlsx`|`csv`).
- **Implementación**: llama a `getTopImpacto(filtros)` (la misma Server Action que usa la UI) y exporta `resultado.top100` (ya acotado a 100 filas — a diferencia de los demás exports del proyecto, aquí SÍ se acota porque el propio pedido del usuario es "los 100 códigos", no el universo completo). 2 hojas en Excel — "Parámetros" y "Top 100".
- Ver metodología completa (incluida la verificación de rendimiento con `EXPLAIN ANALYZE` antes de construir) en [[Contratación#Nuevo módulo: Análisis de Códigos de Mayor Impacto Económico (2026-07-29)]].

## Server Actions de "Análisis de Códigos de Mayor Impacto Económico"

- **Archivo**: `src/app/actions/top-impacto-actions.ts`. Solo lectura.

| Server Action | Propósito |
|---|---|
| `getOpcionesFiltrosImpacto()` | Opciones para los 4 filtros EPS-completa: prestadores/municipios/contratos vigentes hoy (mismo criterio del resto del proyecto) + años generados de forma fija (2022–actual, sin consultar la BD) |
| `getContratosPrestador(ips)` | Agregado 2026-07-30: contratos vigentes de UN prestador puntual con su `municipio_administracion` ya resuelto — alimenta el selector en cascada Prestador→Contrato(s)→Municipio de la UI (ver [[Contratación#Selector en cascada Prestador → Contrato(s) → Municipio (2026-07-30)]]) |
| `getTopImpacto(filtros, opciones?)` | Ranking Top 100 EPS-completa por valor radicado (procedimientos+medicamentos+insumos o uno solo, según `tipo`), con KPIs y Top 20 por código/prestador/municipio para los gráficos. También reutilizada para el Nivel 2 del drill-down (ver abajo), pasando `filtros.ips` = el prestador de la barra elegida — **fix 2026-07-31**: en ese caso se llama con `opciones = { soloPorCodigo: true }`, que salta las consultas de "top prestadores"/"top municipios" (redundantes con `ips` ya fijo a uno solo, y que el drill-down nunca muestra) — ver [[Problemas Comunes#14. Drill-down de Top Impacto recalculaba consultas pesadas que no usaba]] |
| `getFacturasCodigoImpacto(filtros, tipo, codigo)` | Agregado 2026-07-30: Nivel 3 del drill-down "de lo general a lo particular" — detalle factura por factura de un código para un prestador puntual, acotado por AÑO (no por vigencia de contrato, a diferencia de `getMovimientoRipsCodigo` de "Movimientos RIPS") y con soporte para "consultas" (que ese otro módulo no tiene). Requiere `filtros.ips`. Deduplica facturas re-radicadas en varios lotes (`facturas_canonicas`, ver [[Tablas#`rips_af` — una misma factura puede aparecer duplicada en varios lotes (`consecutivo_rips`) distintos]]). Ver [[Contratación#Drill-down "de lo general a lo particular" en Top 20 prestadores (2026-07-30)]] |

No reutiliza Server Actions de otros módulos (alcance distinto: EPS-completa vs. un prestador puntual) pero SÍ reutiliza el mismo patrón de rendimiento (`rips_af` como filtro previo + `= ANY(ARRAY(subquery))` sobre las tablas RIPS grandes) ya validado en Módulo 4 y en "Movimientos RIPS". Ver metodología completa en [[Contratación#Nuevo módulo: Análisis de Códigos de Mayor Impacto Económico (2026-07-29)]].

## `POST /api/export/analisis-propuesta` ✅ Implementado (2026-07-31)

- **Archivo**: `src/app/api/export/analisis-propuesta/route.ts`.
- **Único endpoint `POST` de exportación del proyecto** (todos los demás son `GET` con query params): el resultado depende de un archivo binario subido por el usuario (la propuesta de tarifas), que no puede viajar serializado en una URL. Recibe el mismo `FormData` (archivo + `municipioCodigo` + `referencia` + `alertaPct`/`criticoPct` + `formato` + `vista`) que la Server Action de la UI.
- **Implementación**: reutiliza `evaluarPropuestaPrestador()` tal cual (la MISMA Server Action que usa la UI) — nunca recalcula la evaluación con una lógica distinta, para que el archivo descargado coincida exacto con lo visto en pantalla.
- **Vista "completo"** (Excel, 4 hojas): "Parámetros", "Resultado por código" (mínimo/máximo/promedio/mediana/variación%/estado/conteo de prestadores/conteo de referencias de mercado EPS), "Prestadores de referencia" (detalle por código+prestador propio) y "Referencias de mercado (otras EPS)" (detalle por código+EPS, con identidad de la EPS — es de uso interno, a diferencia de la vista "contrapropuesta"). En CSV, solo la hoja "Resultado por código".
- **Vista "contrapropuesta"** (documento de trabajo INTERNO, ya NO apto para entregar tal cual a un prestador externo — ver nota abajo): Código, Descripción, Tipo, Precio ofertado y grupos de 4 columnas dinámicos por opción — "Opción N" (valor), "Fuente Opción N" ("Contrato propio" / "Otra EPS"), "Prestador/EPS Opción N" (razón social o nombre de la EPS) y "Contrato Opción N" (número de contrato, solo si es propio) — fusionando los valores YA contratados por Dusakawi y los reportados por otras EPS que sean más económicos que la oferta (rediseño 2026-07-31, ver [[Contratación#Ubicación de la propuesta en el acordeón y contrapropuesta solo-Excel con columnas dinámicas (2026-07-31, mismo día)]]). **Nota 2026-07-31**: el diseño original de este export nunca exponía identidad de terceros; el usuario pidió explícitamente revertir eso para tener el detalle completo (número de contrato + nombre del prestador/EPS) — el archivo debe tratarse como interno y revisarse antes de compartirlo con un prestador.

## Server Actions de "Análisis de Propuesta del Prestador"

- **Archivo**: `src/app/actions/analisis-propuesta-actions.ts`. Solo lectura (el archivo subido nunca se persiste).

| Server Action | Propósito |
|---|---|
| `getOpcionesMunicipiosPropuesta()` | Municipios con al menos 1 contrato vigente (no exige 2+ prestadores como `getOpcionesMunicipios` del Módulo 2 — aquí basta 1 referencia) |
| `evaluarPropuestaPrestador(formData)` | Recibe `FormData` con el archivo (CSV/TXT/XLSX) + municipio + umbrales; parsea (`src/lib/negociacion/analisis-propuesta-parser.ts`), clasifica cada código reutilizando `clasificarCodigos()` (exportada de `historico-prestador-actions.ts` para este reuso), evalúa contra el mercado local propio (`src/lib/negociacion/analisis-propuesta.ts`) y en paralelo consulta `negociacion_contratacion_precio_referencia_eps` (función interna `obtenerReferenciasMercadoEps`, no exportada) para anexar precios de otras EPS por código+municipio |

Reutiliza `obtenerInfoMunicipio` (`comparativo-actions.ts`), `dedupMejorPrecio`/`calcularEstadisticas`/`calcularVariacionPct`/`clasificarSemaforo` (`comparativo.ts`) y `CONFIG_TIPO_TARIFARIO`/`CONTRATOS_EXCLUIDOS_MIGRACION` (`constantes.ts`) — no duplica ninguna consulta ni regla de semáforo ya validada. Ver metodología completa en [[Contratación#Nuevo módulo: Análisis de Propuesta del Prestador (2026-07-31)]].

## `GET /api/export/precio-referencia-eps/plantilla` ✅ Implementado (2026-07-31)

- **Archivo**: `src/app/api/export/precio-referencia-eps/plantilla/route.ts`. Pedido del usuario: *"que me permita descargar la hoja de excel con el formato para subir el archivo así el operador no tendrá que memorizar la estructura, solo bajar la hoja y a alimentarla"*.
- **`GET` sin parámetros** — a diferencia del resto de exports del proyecto (que dependen de un análisis previo), esta plantilla es siempre la misma estructura fija. Botón "Descargar plantilla (Excel)" en `/precio-referencia-eps`, implementado como `<a href=".../plantilla" download>` envuelto en `<Button asChild>` (mismo patrón que `Paginacion` para enlaces, no requiere `fetch`+`blob` porque no depende de `FormData`).
- **3 hojas**: "Instrucciones" (columnas requeridas, cómo se resuelve el municipio, recordatorio de borrar las filas de ejemplo), "Plantilla" (encabezados exactos + 2 filas de ejemplo con los datos reales del pedido original del usuario) y "Municipios válidos" (consulta en vivo `obtenerCatalogoMunicipios()` — la lista exacta de nombres que el parser podrá resolver, para que el operador no escriba un nombre de municipio que luego rebote como "no resuelto"). Si la consulta de municipios falla, la plantilla se genera igual sin esa hoja (degradación defensiva, no bloquea la descarga).

## Server Actions de "Precios de Referencia EPS" (2026-07-31)

- **Archivo**: `src/app/actions/precio-referencia-eps-actions.ts`. **Primer módulo de este proyecto que ESCRIBE datos cargados por el usuario** (el resto son 100% solo lectura contra las tablas SIE) — persiste en `administrativo.negociacion_contratacion_precio_referencia_eps` (tabla con DDL escrito pero **aún no aplicada** en la BD real, ver [[Tablas#Tabla implementada: `negociacion_contratacion_precio_referencia_eps` (2026-07-31)]]).

| Server Action | Propósito |
|---|---|
| `verificarTablaPrecioReferenciaEps()` | Consulta liviana a `information_schema.tables` — si la tabla aún no existe, la UI muestra el banner de migración pendiente en vez de esperar a que una carga/listado falle primero |
| `aplicarMigracionPrecioReferenciaEps()` | **Botón "Aplicar migración" en la propia UI** (2026-07-31) — ejecuta el DDL de `db/migrations/002_precio_referencia_eps.sql` sentencia por sentencia (`CREATE TABLE`, 2× `CREATE INDEX`, `COMMENT ON TABLE`, cada una `IF NOT EXISTS`/idempotente). Restringido a rol `admin` vía `tieneRolMinimo` (`src/lib/auth.ts`) — primera Server Action del proyecto que exige ese gate. Las sentencias van una por una (no el script completo con `BEGIN/COMMIT`) porque el proxy HTTP puede usar el protocolo "extended query" al recibir `params` (aunque sea `[]`), que solo admite una sentencia por llamada |
| `obtenerCatalogoMunicipios()` | Todos los municipios reales de `tb_municipio` (código DANE de 5 dígitos) — cacheado en memoria del proceso. Usado para el filtro de la pantalla y para resolver el texto libre "Municipio" del archivo cargado |
| `cargarPreciosReferenciaEps(formData)` | Parsea el archivo (`precio-referencia-eps-parser.ts`), resuelve cada texto de municipio contra el catálogo DANE (exacto tras normalizar acentos/mayúsculas/espacios; ambiguo o no encontrado se reporta, nunca se adivina) y hace UPSERT en lotes de 300 filas (`ON CONFLICT (nit_entidad, municipio_codigo, codigo) DO UPDATE`, usando el truco `RETURNING (xmax = 0)` para contar insertados vs. actualizados) |
| `listarPreciosReferenciaEps(filtros)` | Listado paginado con filtros por municipio/EPS/código |
| `eliminarPrecioReferenciaEps(id)` | Borrado de una fila puntual |
| `eliminarPreciosReferenciaEpsPorEntidadMunicipio(nit, municipioCodigo)` | Borrado masivo de una carga completa (para reemplazarla por una versión corregida) |

**Nota de coherencia**: el DDL embebido en `aplicarMigracionPrecioReferenciaEps` debe mantenerse IDÉNTICO al de `db/migrations/002_precio_referencia_eps.sql` — si se edita uno, editar el otro. La página `/precio-referencia-eps` recibe `rolActual` como prop desde el Server Component `page.tsx` (`getSession()` en servidor) para decidir si muestra el botón; el gate real de seguridad es server-side dentro de la propia Server Action, el prop solo controla si el botón se ve.

Ver metodología completa en [[Contratación#Módulo: Precios de Referencia de Otras EPS (2026-07-31)]].

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
