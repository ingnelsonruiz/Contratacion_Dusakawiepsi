---
tags: [base-datos, tablas, postgresql, sql]
---

# Tablas

Esquema: `administrativo` (mismo del ecosistema SIE completo). Base de datos: `base_sie_dusakawi`. PostgreSQL 14.19.

## Tabla implementada: `negociacion_contratacion_usuario`

> [!warning] Estado de despliegue
> DDL escrito y **idempotente** (`CREATE TABLE IF NOT EXISTS`), pero **no aplicado en la base de datos todavía**. El conector de solo lectura usado para análisis rechaza escrituras y el entorno de ejecución no tuvo salida de red hacia el proxy en el momento del scaffold. Debe aplicarse manualmente (DBeaver, `psql`, o el pipeline del equipo). Ver [[Pendientes]].

Archivo: `db/migrations/001_negociacion_contratacion_usuario.sql`.

```sql
CREATE TABLE IF NOT EXISTS administrativo.negociacion_contratacion_usuario (
    id                BIGSERIAL PRIMARY KEY,
    username          VARCHAR(100) NOT NULL UNIQUE,
    nombre_completo   VARCHAR(200) NOT NULL,
    password_hash     VARCHAR(64)  NOT NULL, -- SHA-256 hex
    rol               VARCHAR(20)  NOT NULL DEFAULT 'analista',
    activo            SMALLINT     NOT NULL DEFAULT 1,
    usuario_grabado   VARCHAR(100),
    fecha_grabado     TIMESTAMP    NOT NULL DEFAULT now(),
    ultimo_login      TIMESTAMP,
    CONSTRAINT chk_negociacion_contratacion_usuario_rol
        CHECK (rol IN ('analista', 'jefe_contratacion', 'admin')),
    CONSTRAINT chk_negociacion_contratacion_usuario_activo
        CHECK (activo IN (0, 1))
);
```

| Columna | Tipo | Restricción | Descripción |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | Identificador autoincremental |
| `username` | `VARCHAR(100)` | `NOT NULL UNIQUE` | Usuario de acceso |
| `nombre_completo` | `VARCHAR(200)` | `NOT NULL` | Nombre a mostrar en UI |
| `password_hash` | `VARCHAR(64)` | `NOT NULL` | SHA-256 hex (64 caracteres) |
| `rol` | `VARCHAR(20)` | `NOT NULL DEFAULT 'analista'`, `CHECK IN (...)` | `analista`, `jefe_contratacion`, `admin` |
| `activo` | `SMALLINT` | `NOT NULL DEFAULT 1`, `CHECK IN (0,1)` | Bandera de activación (no boolean, consistente con el resto del esquema legado) |
| `usuario_grabado` | `VARCHAR(100)` | — | Auditoría: quién creó el registro |
| `fecha_grabado` | `TIMESTAMP` | `NOT NULL DEFAULT now()` | Auditoría: cuándo |
| `ultimo_login` | `TIMESTAMP` | — | Actualizado por `loginAction` en cada login exitoso |

Ver índice en [[Índices]].

## Tabla implementada: `negociacion_contratacion_precio_referencia_eps` (2026-07-31)

> [!warning] Estado de despliegue
> DDL escrito e **idempotente**, y **no aplicado en la base de datos todavía** por defecto. A diferencia de `negociacion_contratacion_usuario` (que solo se puede aplicar manualmente con `psql`/DBeaver), esta SÍ tiene una vía desde la propia UI: la pantalla `/precio-referencia-eps` detecta si la tabla existe (`verificarTablaPrecioReferenciaEps`) y, si no, muestra un botón **"Aplicar migración"** (solo visible/ejecutable para rol `admin`, ver `aplicarMigracionPrecioReferenciaEps` en [[API#Server Actions de "Precios de Referencia EPS" (2026-07-31)]]) que ejecuta este mismo DDL sentencia por sentencia. Sigue siendo válido aplicarla manualmente si se prefiere. Hasta que se aplique por cualquiera de las dos vías, la carga de archivos de este módulo fallará contra la BD real con un error de tabla inexistente (comportamiento esperado, no un bug).

Archivo: `db/migrations/002_precio_referencia_eps.sql`. Nace del pedido del usuario: alimentar una tabla propia con precios que **otras EPS** (no prestadores/IPS) pagan por un código en un municipio dado, para (1) compararlos contra la propuesta de un prestador en el módulo "Análisis de Propuesta Prestador" y (2) citarlos en la contrapropuesta. Distinta de `negociacion_contratacion_benchmark_mercado` (tabla planificada más abajo, reservada para fuentes públicas de ingesta batch tipo SISMED/datos.gov.co) — esta es alimentada manualmente por el analista vía archivo, con su propia UI de carga/consulta.

```sql
CREATE TABLE IF NOT EXISTS administrativo.negociacion_contratacion_precio_referencia_eps (
    id                  BIGSERIAL PRIMARY KEY,
    nit_entidad         VARCHAR(20)   NOT NULL,
    nombre_entidad      VARCHAR(200)  NOT NULL,
    municipio_codigo    VARCHAR(10)   NOT NULL,
    municipio_nombre    VARCHAR(150)  NOT NULL,
    codigo              VARCHAR(50)   NOT NULL,
    descripcion         TEXT          NOT NULL,
    precio              NUMERIC(14,2) NOT NULL,
    usuario_grabado     VARCHAR(100),
    fecha_grabado       TIMESTAMP     NOT NULL DEFAULT now(),
    fecha_actualizado   TIMESTAMP     NOT NULL DEFAULT now(),
    CONSTRAINT chk_negociacion_contratacion_precio_referencia_eps_precio CHECK (precio > 0),
    CONSTRAINT uq_negociacion_contratacion_precio_referencia_eps UNIQUE (nit_entidad, municipio_codigo, codigo)
);
```

| Columna | Tipo | Restricción | Descripción |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | Identificador autoincremental |
| `nit_entidad` | `VARCHAR(20)` | `NOT NULL` | NIT de la EPS/entidad pagadora de referencia (columna "Nit_prestador" del archivo fuente del usuario — nombre heredado, aunque identifica una EPS, no un prestador/IPS) |
| `nombre_entidad` | `VARCHAR(200)` | `NOT NULL` | Razón social de la EPS (columna "Prestador" del archivo fuente) |
| `municipio_codigo` | `VARCHAR(10)` | `NOT NULL` | Código DANE (`tb_municipio.municipio`), **resuelto en la carga** a partir del texto libre de la columna "Municipio" del archivo — nunca se confía en el texto libre como dimensión de cruce (mismo criterio que el resto del proyecto: comparar siempre por código DANE, no por nombre) |
| `municipio_nombre` | `VARCHAR(150)` | `NOT NULL` | Texto tal como venía en el archivo original — solo para auditoría/trazabilidad |
| `codigo` | `VARCHAR(50)` | `NOT NULL` | Código CUPS/CUM/insumo, tal como lo reporta la EPS de origen — se cruza por igualdad de texto contra `FilaEvaluacionPropuesta.codigo`, sin volver a clasificar contra tb_cup/tb_medicamento/tb_insumo (la descripción ya viene dada en el archivo) |
| `descripcion` | `TEXT` | `NOT NULL` | Descripción del código, tal como la reporta la EPS de origen |
| `precio` | `NUMERIC(14,2)` | `NOT NULL`, `CHECK > 0` | Precio reportado por esa EPS para ese código en ese municipio |
| `usuario_grabado` / `fecha_grabado` | — | — | Auditoría: quién y cuándo se creó la fila (convención transversal del esquema) |
| `fecha_actualizado` | `TIMESTAMP` | `NOT NULL DEFAULT now()` | Se actualiza en cada UPSERT — permite saber qué tan reciente es cada precio de referencia |

**Upsert, no historial**: la restricción `UNIQUE (nit_entidad, municipio_codigo, codigo)` hace que volver a cargar el mismo archivo (o una versión corregida/actualizada) actualice el precio existente en vez de duplicar la fila — se prioriza tener SIEMPRE el precio más reciente conocido por combinación EPS+municipio+código, no un historial de cambios (a diferencia de, por ejemplo, `negociacion_contratacion_snapshot_tarifario` planificada más abajo, que si es explícitamente versionada).

Ver también [[Contratación#Módulo: Precios de Referencia de Otras EPS (2026-07-31)]].

## Tablas planificadas (esquema `administrativo`, prefijo `negociacion_contratacion_`)

Ninguna tiene DDL escrito todavía — diseño conceptual documentado en `docs/ARQUITECTURA.md` §3.2.

| Tabla | Rol |
|---|---|
| `negociacion_contratacion_snapshot_tarifario` | Snapshots versionados del tarifario contratado (reemplaza el patrón "Excel histórico" 2025 vs 2026) |
| `negociacion_contratacion_consumo_agregado` | Pre-agregación ETL de `rips_ap/am/at` por prestador+código+período+tipo |
| `negociacion_contratacion_benchmark_mercado` | Precios de referencia externos (SISMED/datos.gov.co/ISS 2001), ingesta batch |
| `negociacion_contratacion_escenario` | Encabezado de simulación de negociación |
| `negociacion_contratacion_escenario_detalle` | Líneas de la simulación (código, tarifas, consumo proyectado, impacto) |
| `negociacion_contratacion_ronda_negociacion` | Historial de ofertas/contraofertas por ronda |
| `negociacion_contratacion_exclusion_calidad` | Exclusión de registros atípicos del cálculo estadístico, sin tocar el dato origen |
| `negociacion_contratacion_log_auditoria` | Auditoría de acciones (exportaciones, cambios de escenario) |
| `negociacion_contratacion_indicador_cache` | Cache de KPIs pesados del dashboard ejecutivo |

> [!note] Convención transversal
> Todas las tablas (implementadas o planificadas) deben llevar `usuario_grabado`/`fecha_grabado` (consistencia con el resto del esquema) y claves foráneas explícitas — a diferencia de varias tablas legadas del esquema SIE que no las declaran.

## Tablas SIE existentes (consultadas, nunca modificadas)

| Tabla | Uso en este proyecto | Filas aprox. |
|---|---|---:|
| `ct_ips_contrato` | Contratos. PK `consecutivo_contrato`. FKs a los 3 tarifarios: `consecutivo_tarifario_servicio/medicamento/insumo` | — |
| `ct_ips` | Datos del prestador (NIT, código habilitación, razón social). Join por `ips` | — |
| `tb_tarifario_propio_encabezado` | Encabezado del tarifario contratado. PK `consecutivo_tarifario` | — |
| `tb_tarifario_propio_detalle` | Detalle del tarifario (Procedimientos/Medicamentos/Insumos/Paquetes/Otros). FK `consecutivo_tarifa` → `tb_tarifario_propio_encabezado.consecutivo_tarifario` | ~1.45 M |
| `tb_cup`, `tb_medicamento`, `tb_insumo`, `tb_marca_medicamento`, `tb_unidad_medida`, `tb_tipo_contrato`, `tb_modalidad_contrato` | Maestros de descripción/clasificación (CUPS, CUM, insumo, laboratorio, unidad, tipo/modalidad de contratación) | — |
| `tb_concepto_nota_tecnica` | Modelo de servicio (no usado por el Módulo 1 todavía) | — |
| `rips_ap` | Consumo real facturado — procedimientos | ~177.7 M |
| `rips_am` | Consumo real facturado — medicamentos | ~81.8 M |
| `rips_at` | Consumo real facturado — insumos | ~60.1 M |
| `rips_resumen`, `rips_af` | Consumo real facturado — resumen y facturación | — |
| `log_sc_factura_pago_detallado` | Costo real pagado (vs. facturado) | — |

> [!danger] Hallazgo crítico verificado (2026-07-29) — `rips_af.consecutivo_rips` NO es único, no es un ID de factura
> Se asumía en todo el proyecto (patrón usado en decenas de queries) que `consecutivo_rips` identifica una factura de forma única. Es falso — se comporta como un identificador de **lote/radicación** compartido por muchas facturas del mismo prestador el mismo día. Verificado: `consecutivo_rips = 720812` aparece en **951 filas distintas** de `rips_af` (951 `numero_factura`/`consecutivo_rips_af` diferentes, mismo `codigo_prestador`, misma `fecha_servicio_rips`). El identificador realmente único de factura es `consecutivo_rips_af` (PK real, `rips_af_pk`).
>
> **Consecuencia práctica**: usar `consecutivo_rips` como **filtro** (`WHERE consecutivo_rips = ANY(subquery)`) contra `rips_ap`/`rips_ac`/`rips_am`/`rips_at` es seguro — no multiplica filas. Pero usarlo como condición de un **`JOIN`** de vuelta hacia `rips_af` (para traer, por ejemplo, `codigo_prestador` de la factura) SIN deduplicar primero produce fanout: cada línea de detalle se multiplica por la cantidad de facturas que comparten ese `consecutivo_rips` (hasta 951x en el caso verificado). Este bug real infló un KPI de "Top Impacto Económico" de $11.260.116.450 reales a $7.483.119.066.500 mostrados — ver el diagnóstico y fix completos (`DISTINCT ON (consecutivo_rips)`) en [[Contratación#🔴 Bug crítico introducido por la mejora anterior, corregido el mismo día: `rips_af.consecutivo_rips` NO es único]].
>
> **Regla para cualquier código futuro**: si se necesita el `codigo_prestador` (u otro campo) de la factura que contiene una línea de detalle, deduplicar `rips_af` por `consecutivo_rips` ANTES de usarlo como lado de un `JOIN` (ej. `SELECT DISTINCT ON (consecutivo_rips) consecutivo_rips, codigo_prestador FROM rips_af WHERE ... ORDER BY consecutivo_rips`). Se verificó que `codigo_prestador` es consistente entre las filas de un mismo `consecutivo_rips` en la enorme mayoría de casos (717 grupos EPS-completa, todos los años, con más de un valor distinto — inconsistencia de origen, no de la consulta).

## Módulo 1 (Tarifario) — detalle real de `tb_tarifario_propio_detalle` ✅

> [!danger] Hallazgo crítico verificado — `consecutivo_cup` está SIEMPRE en NULL
> Se verificó contra **toda la tabla** (114.226 filas de tipo servicio en `base_sie_dusakawi`, no solo un contrato): la FK `d.consecutivo_cup` que en teoría enlaza cada línea con `tb_cup` **nunca está poblada** (0/114.226). No es un problema de un contrato puntual — es característico de cómo ARYUWIS carga estos tarifarios (probablemente el importador masivo nunca resuelve esa FK; ver también el caso del importador de tarifarios documentado en el `CLAUDE.md` de `Proyecto_Dusakawi`, sección 9).
>
> **Consecuencia práctica**: no se puede usar `consecutivo_cup IS NOT NULL` para distinguir "Procedimiento real (CUPS)" de "Otro (sin CUPS)". La forma confiable es cruzar `d.codigo_tarifa` contra `tb_cup.codigo_interno` (columna con índice único `tb_cup_idx_unico`) — de esas 114.226 filas, 81.086 (71%) son recuperables así con descripción idéntica, y 33.140 (29%) son genuinamente ítems sin CUPS estándar. Ver la implementación en [[Contratación#Clasificación de Procedimientos vs. Otros]] y el código en `src/app/actions/tarifario-actions.ts`.

> [!danger] Hallazgo crítico verificado — `consecutivo_medicamento` peor que NULL: apunta a un registro INCORRECTO
> A diferencia de `consecutivo_cup` (siempre NULL), `consecutivo_medicamento` casi siempre está **poblada pero equivocada**. Caso real detectado por el usuario (contrato `20001_132EV`, vencido, tarifario de medicamentos `50002558`): **1.570 filas con códigos y precios distintos** (`VALPROICO ACIDO`, `ALOPURINOL`, `HALOPERIDOL`, etc.) tenían **todas** el mismo `consecutivo_medicamento = 124550` (LOSARTAN 50mg) — la UI mostraba "LOSARTAN" repetido 1.559 veces con precios distintos, que es justo el síntoma que reportó el usuario. Verificado a escala de toda la BD: de 977.315 filas en tarifarios de medicamentos, solo **1** tenía la FK coincidiendo con su propio código.
>
> **Consecuencia práctica**: igual que Procedimientos, se cruza `d.codigo_tarifa` contra `tb_medicamento.codigo_interno` en vez de confiar en la FK. Para este contrato puntual, 1.688 de 1.692 filas (99,8%) son recuperables así con el medicamento real. A escala de toda la BD el porcentaje recuperable baja a ~26% — se detectó que muchos tarifarios de "medicamentos" mezclan códigos que en realidad son procedimientos CUPS (ej. `890211 CONSULTA DE PRIMERA VEZ POR FISIOTERAPIA` apareciendo dentro del tarifario de medicamentos de otro contrato) — una inconsistencia de captura en ARYUWIS ajena a este proyecto, no algo que se pueda corregir desde aquí.

> [!warning] `consecutivo_insumo` — mismo patrón que `consecutivo_cup`
> También **siempre NULL** (23.000/23.000 filas verificadas). Se recupera igual, cruzando `d.codigo_tarifa` contra `tb_insumo.codigo_interno` (77% recuperable a escala de toda la BD).

Columnas relevantes de `tb_tarifario_propio_detalle` usadas por el Módulo 1:

| Columna | Tipo | Uso |
|---|---|---|
| `consecutivo_tarifa` | `bigint` | FK al tarifario (`tb_tarifario_propio_encabezado.consecutivo_tarifario`) |
| `codigo_tarifa` / `codigo_propio` | `varchar` | Código del ítem negociado. `codigo_tarifa` es el que coincide con `tb_cup.codigo_interno` / `tb_medicamento.codigo_interno` / `tb_insumo.codigo_interno` |
| `descripcion` | `text` | Descripción del ítem |
| `valor`, `valor_servicio`, `valor_base`, `valor_pactado`, `valor_regulado` | `numeric`/`double precision` | Ver prioridad de resolución en [[Contratación#Resolución del valor final]] — no todas están pobladas para todo tipo de contrato |
| `porcentaje_tarifa` | `double precision` | % negociado sobre `valor_base` |
| `sw_paquete` | `smallint` | `1` = la fila pertenece a la pestaña Paquetes (cruzando servicios+medicamentos+insumos) |
| `consecutivo_cup` / `consecutivo_medicamento` / `consecutivo_insumo` | `bigint` | **Ninguna de las 3 FKs es confiable** — `consecutivo_cup`/`consecutivo_insumo` siempre NULL, `consecutivo_medicamento` poblada pero casi siempre apuntando al registro equivocado. Las 3 pestañas (Procedimientos, Medicamentos, Insumos) resuelven el maestro real cruzando por `codigo_tarifa`, no por estas columnas |

## Módulo 2 (Comparativo) — `tb_municipio` es auto-referenciada

`ct_ips.municipio` es un código estilo DANE (`varchar`, ej. `"20001"` = Valledupar), no texto libre. Su nombre se resuelve contra `tb_municipio.municipio` → `tb_municipio.descripcion`. El departamento **no es una columna de texto**: `tb_municipio.departamento` es OTRO código que también vive en `tb_municipio.municipio` — hace falta un segundo self-join sobre la misma tabla para resolver el nombre del departamento (mismo patrón documentado en `CLAUDE.md` de `Proyecto_Dusakawi` para `tb_municipio` en otros módulos del ecosistema, ej. `af_afiliado`/autorizaciones).

```sql
JOIN administrativo.tb_municipio munA ON munA.municipio = c.municipio_administracion  -- nombre del municipio (del CONTRATO)
JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento           -- nombre del departamento (self-join)
```

Verificado con datos reales (2026-07-28): Valledupar (`20001`, departamento Cesar `20`) es el municipio con más prestadores comparables (34), seguido de Riohacha (`44001`, La Guajira, 15) y San Juan Del Cesar (`44650`, La Guajira, 9).

> [!danger] Hallazgo — contratos capitados generan falsos "críticos" en el semáforo si no se filtran
> Al calcular la variabilidad de tarifas por municipio (Valledupar, tipo Procedimientos) aparecieron códigos con "amplitud" de 400-600% que resultaron ser un artefacto de datos, no variabilidad real: algunos prestadores tienen ese código con **valor final = 0** porque su contrato es capitado (el servicio va incluido en el pago per cápita, no se tarifa por evento) mientras otros prestadores del mismo municipio SÍ lo tarifan por evento con un valor real. Comparar $0 (capitado) contra $38.000 (por evento) no es una variación de precio negociado, es una diferencia de modalidad de contratación. **Fix aplicado en `comparativo-actions.ts`**: se descartan las filas con `valorFinal <= 0` antes de agrupar/calcular estadísticas — si tras el descarte quedan menos de 2 prestadores con precio real, el código no se muestra como comparable.

> [!danger] Hallazgo crítico verificado (2026-07-30) — el municipio de agrupación del Módulo 2 era el del PRESTADOR, no el del CONTRATO
> Reportado por el usuario contra un caso real en "Perfil Competitivo del Prestador": GYO MEDICAL I.P.S. S.A.S. (`ips` 801870) mostraba "Municipios donde opera: 1 — Riohacha", pero sus 2 contratos vigentes (`EV-44430-2026-56`, `EV-44650-2026-112`) tienen **Municipio Administración** Maicao (`44430`) y San Juan Del Cesar (`44650`) respectivamente — ninguno de los dos es Riohacha. Causa raíz verificada contra la BD real: todas las consultas de agrupación del Módulo 2 (`comparativo-actions.ts`, `dashboard-riesgo-actions.ts`) usaban `ct_ips.municipio` (municipio de **registro/sede** del prestador, fijo por `ips`) como dimensión de agrupación, en vez de `ct_ips_contrato.municipio_administracion` (municipio bajo el cual se administra/negocia **cada contrato** — columna `varchar`, poblada y con código DANE válido en el 100% de los 2.692 contratos de la tabla, nunca NULL). Un mismo prestador puede tener contratos administrados en municipios distintos al de su sede registrada — verificado a escala de toda la BD: **91 de 279 contratos vigentes (~33%)** tienen `municipio_administracion` distinto de `ct_ips.municipio`.
>
> **Consecuencia práctica**: agrupar por `ct_ips.municipio` mezclaba, dentro de un mismo "municipio" de comparación, tarifas negociadas realmente para municipios distintos (ej. tarifas administradas en Maicao/San Juan Del Cesar cayendo en el grupo "Riohacha") — exactamente el efecto que la regla de negocio central del módulo ("comparar SIEMPRE dentro del mismo municipio", ver más abajo) busca evitar. Esto afectaba las 3 vistas construidas sobre esta agrupación: Comparativo por municipio/código, Dashboard Analítico de Riesgo (Fase A) y Perfil Competitivo del Prestador (incluida la tarjeta "Municipios donde opera").
>
> **Fix aplicado**: las 3 consultas de agrupación (`getOpcionesMunicipios`, `construirGruposMunicipio`, `getComparativoPorCodigo` en `comparativo-actions.ts`, y `construirGruposTodosMunicipios` en `dashboard-riesgo-actions.ts`) ahora agrupan/filtran por `c.municipio_administracion` en vez de `ips.municipio`. Verificado tras el fix: los 1.130 ítems de tarifario de servicios del contrato `EV-44430-2026-56` quedan en el grupo Maicao y los 1.126 del contrato `EV-44650-2026-112` en San Juan Del Cesar, coincidiendo con lo esperado por el usuario.
>
> **Nota de alcance**: el módulo "Análisis de Códigos de Mayor Impacto Económico" (`top-impacto-actions.ts`) también agrupa "por municipio" usando `ct_ips.municipio`, pero ahí la pregunta de negocio es distinta (dónde está físicamente el prestador que radicó el RIPS, no bajo qué municipio se negoció un tarifario) — no se modificó como parte de este fix; evaluar con el usuario si también debería usar `municipio_administracion` en una revisión futura.

## `rips_at` (tipo "insumos" en Módulo 4 / Top Impacto) — códigos de estancia son CUPS reales, no insumos

> [!danger] Hallazgo crítico verificado (2026-07-30) — códigos de "internación"/estancia sin descripción por resolver contra el catálogo equivocado
> Reportado por el usuario: en "Análisis de Códigos de Mayor Impacto Económico", varios de los códigos con mayor valor radicado (`108A01`, `107M01`, `106M01`, `105M01`, `110A01`, `120B01`) aparecían sin descripción (mostraban el código repetido, ej. "108A01 — 108A01"). Causa raíz verificada contra la BD real: estos son códigos **CUPS reales** (ej. `108A01` = "INTERNACIÓN EN UNIDAD DE CUIDADO INTENSIVO NEONATAL", con fila propia en `tb_cup`), pero ARYUWIS los reporta vía el archivo RIPS de **"otros servicios" (`rips_at`, columna `codigo_servicio`)** en vez del archivo de procedimientos (`rips_ap`) — probablemente porque son cargos por día de estancia, no por procedimiento puntual. Como el módulo resolvía la descripción de "insumos" únicamente contra `tb_insumo`, y estos códigos no tienen fila ahí, la descripción quedaba en NULL.
>
> **Magnitud verificada** (EPS completa, año 2026, sobre `rips_at`): de 8.288 códigos distintos, solo 1.091 (13%) resuelven en `tb_insumo` (insumos reales); **354 (4,3% de los códigos) resuelven ÚNICAMENTE en `tb_cup`** — y en valor, esos 354 códigos representan **$49.329.517.821 de $67.523.703.878 (73% del total facturado bajo "insumos")**, muy por encima del 9% ($6.059.866.212) que sí corresponde a insumo real. El 18% restante ($12.134.319.844) no resuelve en ningún catálogo — gap real de calidad de dato en ARYUWIS, no corregible desde este proyecto.
>
> **Fix aplicado**: se agregó un `LEFT JOIN` de respaldo contra `tb_cup` (además del ya existente contra `tb_insumo`, con `COALESCE`) en `obtenerPorCodigo` (`top-impacto-actions.ts`, config `TABLA_TIPO.insumos.catalogoFallback`) y en `obtenerConsumoInsumos` (`consumo-frecuencia-actions.ts`, Módulo 4) — mismo patrón "insumo → tb_insumo, si no resuelve intentar tb_cup", consistente con `clasificarCodigos()` de Módulo 3 (`historico-prestador-actions.ts`), que ya probaba varios catálogos en cascada. Verificado tras el fix contra el prestador reportado (GYO MEDICAL, código_prestador `444300078003`, 2026): los 6 códigos reportados ahora resuelven su descripción correctamente.
>
> **No corregido, y deliberadamente fuera de alcance**: la clasificación de estos códigos sigue siendo "Insumo" en la UI (tipo de tarifario donde aparecen), aunque conceptualmente son procedimientos/estancias CUPS — cambiar esa clasificación es una decisión de producto (¿debería "108A01" contarse como Servicio en vez de Insumo en los KPIs?), no solo un fix de descripción; se dejó tal cual hasta que el usuario decida si vale la pena reclasificar.

## `rips_ac` (consultas) — columnas confirmadas contra la BD real

`rips_ac.numero_factura` y `rips_ac.fecha_consulta` quedaron confirmadas con `information_schema.columns` contra la BD real (2026-07-30, vía conector de solo lectura) — el drill-down de Top Impacto (`getFacturasCodigoImpacto`, tipo "consultas") usa estos nombres con seguridad.

## `rips_af` — una misma factura puede aparecer duplicada en varios lotes (`consecutivo_rips`) distintos

> [!danger] Hallazgo crítico verificado (2026-07-30) — recargas de RIPS no limpiadas inflaban los totales hasta 13x en casos puntuales
> Reportado por el usuario contra un caso real: en el drill-down de facturas de "Top Impacto" (Nivel 3, código S50008 de MOVILIDAD VITAL SAS), la factura `MV06370` mostraba **$850.000 / 10 unidades**, mientras que en ARYUWIS esa misma factura vale **$170.000 / 2 unidades** — una diferencia de exactamente 5x.
>
> **Causa raíz verificada contra la BD real**: `rips_af` tenía 5 filas distintas para `numero_factura = 'MV06370'` (`consecutivo_rips` 638053, 638054, 672291, 672309, 672377), las 5 con `valor_neto = 170.000` (el mismo valor real) — pero solo 1 (`consecutivo_rips = 672377`) tiene `fecha_radica` poblada (`2026-03-16`, coincide exacto con el campo "Fecha Radicado" que ARYUWIS muestra para esa factura) y progreso real de auditoría (`estado_soporte = 2`, `total_pagar = 164.050`). Las otras 4 tienen `estado_soporte = 0` y `fecha_radica IS NULL` — son copias sin procesar de una recarga repetida del mismo archivo RIPS, nunca limpiadas. Cada copia trae la MISMA línea de insumo S50008 (2 unidades × $85.000), así que sumar sin deduplicar por factura cuenta 5× el valor real.
>
> **No es un caso aislado**: para este mismo prestador, decenas de facturas tienen entre 11 y 13 copias duplicadas cada una (mismo patrón: un lote reinserta TODAS las facturas históricas del prestador otra vez). A escala EPS-completa (año 2026, sin filtro de prestador): 235.178 filas en `rips_af` vs. **186.108 facturas realmente distintas** — sumar `valor_neto` sin deduplicar da $233.300.941.088; deduplicando una fila por factura da $217.135.501.828 — una inflación de **$16.165.439.260 (7,4%) a nivel EPS**, mucho peor para prestadores puntuales con alta tasa de recarga (11-13x).
>
> **Consecuencia práctica**: esto afecta a CUALQUIER consulta que agregue las tablas RIPS grandes (`rips_ap`/`rips_ac`/`rips_am`/`rips_at`) filtrando solo por `consecutivo_rips = ANY(...)` sin deduplicar también por factura real (`codigo_prestador` + `numero_factura`) — es decir, los 3 módulos que hacen esto: "Análisis de Códigos de Mayor Impacto Económico" (KPIs, Top 20 por código/prestador/municipio, y el drill-down nuevo), "Consumo y Frecuencia" (Módulo 4) y "Movimientos RIPS" (usado desde el acordeón de "Perfil Competitivo del Prestador").
>
> **Criterio de deduplicación** (confirmado con el usuario 2026-07-30): entre las copias de una misma factura, se elige la que tenga `fecha_radica IS NOT NULL` (la más reciente si hay más de una, para cubrir re-radicaciones legítimas por corrección) — verificado que coincide exacto con "Fecha Radicado" de ARYUWIS. Las facturas donde NINGUNA copia tiene `fecha_radica` (~3,3% EPS-completa, ≈6.134 de 186.108 en 2026 — datos reportados pero nunca radicados formalmente) se incluyen igual, tomando 1 copia arbitraria (desempate determinístico por `consecutivo_rips`) — decisión de negocio: mejor sobre-incluir que subestimar el valor real facturado.
>
> **Fix aplicado**: nuevo helper compartido `src/lib/negociacion/rips-dedup.ts` (`sqlFacturasCanonicas`/`joinFacturaCanonica`) — agrega una CTE `facturas_canonicas` (1 fila por `codigo_prestador`+`numero_factura`, la copia ganadora) y un `JOIN` adicional sobre `numero_factura` + el `consecutivo_rips` ganador antes de agregar cualquier tabla RIPS grande. Aplicado en `top-impacto-actions.ts` (`construirJoinFactura`, `getFacturasCodigoImpacto`), `consumo-frecuencia-actions.ts` (`obtenerConsumoServicios/Medicamentos/Insumos`, más el conteo de "facturas del rango" para el KPI) y `movimiento-rips-actions.ts` (`obtenerMovimientoServicios/Medicamentos/Insumos`). Verificado tras el fix, con el caso real reportado: la factura `MV06370` ahora muestra 2 unidades / $170.000 (coincide con ARYUWIS).
>
> **Rendimiento verificado con `EXPLAIN ANALYZE`**: la consulta más pesada afectada (`rips_at`, ~60M filas, año 2026 completo, SIN filtro de prestador) corrió en 4,78s con el fix — dentro del mismo rango ya aceptado para este módulo (3-10s), conservando el `Index Scan` sobre `rips_at_idx_rips` que ya se documentó como crítico.
>
> **Verificación post-deploy (2026-07-30)**: con el fix ya en producción, se repitió la consulta EPS-completa (tipo "Todos", año 2026, sin filtros) directamente contra la BD real y los 4 KPIs de la pantalla coincidieron exactos: Valor total radicado $162.194.615.413, Total de registros radicados 4.314.174, Total de códigos diferentes 18.680, Código de mayor impacto `129M02` $4.993.912.409. También se verificó que el Top 20 de prestadores mostrado coincide al peso con el cálculo directo, y que los 20 prestadores actualmente en ese ranking tienen un factor de duplicación de facturas de apenas 1.00x-1.03x (es decir, el bug los afectaba mínimamente) — MOVILIDAD VITAL SAS (factor 6,56x) salió del Top 20 tras la corrección, como se esperaba.
>
> **Pendiente/fuera de alcance**: esta es una corrección a nivel de consulta (capa de lectura), no del dato de origen — las copias duplicadas siguen existiendo físicamente en `rips_af`/`rips_ap`/`rips_ac`/`rips_am`/`rips_at`. Valdría la pena que TI/ARYUWIS investigue por qué el proceso de carga de RIPS reinserta lotes completos sin limpiar/reemplazar las cargas anteriores del mismo prestador — un fix en el origen evitaría que la tabla siga creciendo con copias basura y que cualquier consulta futura (de este proyecto o de otro) tenga que recordar aplicar esta deduplicación.

## Ver también
- [[Modelo ER]]
- [[Relaciones]]
- [[Índices]]
- [[Contratación]]
