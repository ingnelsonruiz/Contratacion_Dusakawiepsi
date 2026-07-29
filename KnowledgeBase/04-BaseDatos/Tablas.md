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
JOIN administrativo.tb_municipio munA ON munA.municipio = ips.municipio       -- nombre del municipio
JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento   -- nombre del departamento (self-join)
```

Verificado con datos reales (2026-07-28): Valledupar (`20001`, departamento Cesar `20`) es el municipio con más prestadores comparables (34), seguido de Riohacha (`44001`, La Guajira, 15) y San Juan Del Cesar (`44650`, La Guajira, 9).

> [!danger] Hallazgo — contratos capitados generan falsos "críticos" en el semáforo si no se filtran
> Al calcular la variabilidad de tarifas por municipio (Valledupar, tipo Procedimientos) aparecieron códigos con "amplitud" de 400-600% que resultaron ser un artefacto de datos, no variabilidad real: algunos prestadores tienen ese código con **valor final = 0** porque su contrato es capitado (el servicio va incluido en el pago per cápita, no se tarifa por evento) mientras otros prestadores del mismo municipio SÍ lo tarifan por evento con un valor real. Comparar $0 (capitado) contra $38.000 (por evento) no es una variación de precio negociado, es una diferencia de modalidad de contratación. **Fix aplicado en `comparativo-actions.ts`**: se descartan las filas con `valorFinal <= 0` antes de agrupar/calcular estadísticas — si tras el descarte quedan menos de 2 prestadores con precio real, el código no se muestra como comparable.

## Ver también
- [[Modelo ER]]
- [[Relaciones]]
- [[Índices]]
- [[Contratación]]
