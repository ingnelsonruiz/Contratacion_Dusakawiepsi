---
name: Schema_Base_de_Datos
description: Esquema completo de tablas, columnas, relaciones e índices — propias y SIE (solo lectura)
ultima_actualizacion: 2026-09-08
---

# 🗄️ Schema Base de Datos

Schema: `administrativo` | BD: `base_sie_dusakawi`

---

## Tablas Propias del Proyecto (`negociacion_contratacion_*`)

### `negociacion_contratacion_usuario`

> ⚠️ DDL escrito pero **NO aplicado** en la BD real. Aplicar con `db/migrations/001_negociacion_contratacion_usuario.sql`.

```sql
CREATE TABLE IF NOT EXISTS administrativo.negociacion_contratacion_usuario (
    id                BIGSERIAL PRIMARY KEY,
    username          VARCHAR(100) NOT NULL UNIQUE,
    nombre_completo   VARCHAR(200) NOT NULL,
    password_hash     VARCHAR(64)  NOT NULL, -- SHA-256 hex sin salt
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

CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_usuario_activo
    ON administrativo.negociacion_contratacion_usuario (activo);
```

| Rol | Nivel | Descripción |
|---|---|---|
| `analista` | 0 | Acceso a consulta de módulos de análisis |
| `jefe_contratacion` | 1 | Incluye todo lo del analista |
| `admin` | 2 | Incluye todo lo anterior + gestión usuarios/auditoría |

---

### `negociacion_contratacion_precio_referencia_eps`

> ⚠️ DDL escrito pero **NO aplicado** por defecto. Aplicar con botón "Aplicar migración" (rol `admin`) o con `db/migrations/002_precio_referencia_eps.sql`. Hasta que se aplique, la carga de archivos fallará con error de tabla inexistente.

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
    CONSTRAINT uq_negociacion_contratacion_precio_referencia_eps
        UNIQUE (nit_entidad, municipio_codigo, codigo)
);
```

> **Upsert, no historial:** La restricción UNIQUE hace que recargar el mismo archivo actualice el precio en lugar de duplicar la fila.  
> **Resolución de municipio:** texto libre → código DANE. Si el nombre es ambiguo o no existe, la fila NO se carga y se reporta en `municipiosNoResueltos`.

---

## Tablas Planificadas (sin DDL escrito — diseño conceptual)

| Tabla | Rol |
|---|---|
| `negociacion_contratacion_snapshot_tarifario` | Snapshots versionados del tarifario contratado |
| `negociacion_contratacion_consumo_agregado` | Pre-agregación ETL de `rips_ap/am/at` por prestador+código+período+tipo |
| `negociacion_contratacion_benchmark_mercado` | Precios de referencia externos (SISMED/datos.gov.co) |
| `negociacion_contratacion_escenario` | Encabezado de simulación de negociación |
| `negociacion_contratacion_escenario_detalle` | Líneas de la simulación |
| `negociacion_contratacion_ronda_negociacion` | Historial de ofertas/contraofertas por ronda |
| `negociacion_contratacion_exclusion_calidad` | Exclusión de registros atípicos del cálculo estadístico |
| `negociacion_contratacion_log_auditoria` | Auditoría de acciones (exportaciones, cambios de escenario) |
| `negociacion_contratacion_indicador_cache` | Cache de KPIs pesados del dashboard ejecutivo |

---

## Tablas SIE — Solo Lectura (`rips_*`, `ct_*`, `tb_*`)

| Tabla | Filas aprox. | Uso principal |
|---|---:|---|
| `ct_ips_contrato` | — | Contratos (PK `consecutivo_contrato`) |
| `ct_ips` | — | Datos del prestador (NIT, código habilitación, razón social) |
| `tb_tarifario_propio_encabezado` | — | Encabezado del tarifario contratado |
| `tb_tarifario_propio_detalle` | ~1.45 M | Detalle del tarifario |
| `tb_cup` | — | Catálogo CUPS — índice único `tb_cup_idx_unico` en `codigo_interno` |
| `tb_medicamento` | — | Catálogo de medicamentos |
| `tb_insumo` | — | Catálogo de insumos |
| `tb_marca_medicamento` | — | Marcas de medicamento |
| `tb_unidad_medida` | — | Unidades de medida |
| `tb_tipo_contrato` | — | Tipos de contrato |
| `tb_modalidad_contrato` | — | Modalidades de contrato |
| `tb_municipio` | — | Municipios DANE |
| `rips_af` | 10.2 M | Encabezado de factura RIPS |
| `rips_ap` | ~177.7 M | Procedimientos (consumo real) |
| `rips_am` | ~81.8 M | Medicamentos (consumo real) |
| `rips_at` | ~60.1 M | Insumos/materiales (consumo real) |
| `rips_ac` | 44.5 M | Consultas |
| `rips_ah` | 733 K | Hospitalizaciones |
| `rips_resumen` | — | Resumen RIPS |
| `log_sc_factura_pago_detallado` | — | Costo real pagado (vs. facturado) |

---

## Columnas Clave por Tabla RIPS

### `rips_af` — Encabezado de Factura

| Columna | Tipo | Notas |
|---|---|---|
| `consecutivo_rips_af` | BIGINT | PK real única de la factura |
| `consecutivo_rips` | — | ⚠️ NO ÚNICO — identificador de lote/radicación. Verificado: hasta 951 filas con mismo valor |
| `numero_factura` | VARCHAR | Número de factura del prestador |
| `codigo_prestador` | VARCHAR | Clave para filtrar por prestador |
| `fecha_factura` | DATE | Fecha de la factura |
| `fecha_radica` | DATE | Fecha de radicación (NULL en copias duplicadas) |
| `valor_neto` | NUMERIC | Valor neto de la factura |
| `consecutivo_contrato` | — | FK al contrato |

> 🚨 **DANGER:** `rips_af` contiene duplicados por recarga de lotes. 235.178 filas vs. 186.108 facturas realmente distintas (inflación 7.4%, hasta 13x en casos puntuales). Siempre deduplicar antes de agregar.

### `rips_ap` — Procedimientos

| Columna | Uso |
|---|---|
| `consecutivo_rips` | JOIN con `rips_af` (deduplicado) |
| `codigo_procedimiento` | Código real del servicio |
| `valor_procedimiento` | Valor unitario |
| Cantidad | `COUNT(*)` — 1 fila = 1 evento |

### `rips_am` — Medicamentos

| Columna | Uso |
|---|---|
| `consecutivo_rips` | JOIN con `rips_af` |
| `codigo_medicamento` | Código real |
| `numero_unidades` | Cantidad → `SUM(numero_unidades)` |
| `valor_total_medicamento` | Valor → `SUM(valor_total_medicamento)` |

### `rips_at` — Insumos/Materiales

| Columna | Uso |
|---|---|
| `consecutivo_rips` | JOIN con `rips_af` |
| `codigo_servicio` | ✅ Código real del insumo |
| `codigo_tarifario` | 🚨 SIEMPRE NULL — nunca usar |
| `cantidad` | Cantidad → `SUM(cantidad)` |
| `valor_total_material` | Valor → `SUM(valor_total_material)` |

### `tb_tarifario_propio_detalle` — Detalle del Tarifario

| Columna | Notas |
|---|---|
| `codigo_tarifa` | Código del ítem tarifado — usar para JOIN con catálogos |
| `consecutivo_cup` | 🚨 NULL en 100% de filas — no usar |
| `consecutivo_medicamento` | 🚨 Poblada pero INCORRECTA — no usar |
| `consecutivo_insumo` | 🚨 NULL en 100% de filas — no usar |
| `valor_pactado` | Valor negociado (prioritario) |
| `valor_base` | Base tarifaria |
| `porcentaje_tarifa` | % sobre base |
| `valor` | Valor general (último recurso) |
| `sw_paquete` | 1 = paquete, 0 = individual |

### `ct_ips_contrato` — Contratos

| Columna | Notas |
|---|---|
| `consecutivo_contrato` | PK |
| `municipio_administracion` | ✅ Municipio del contrato — usar para agrupación geográfica |
| `fecha_inicio` / `fecha_terminacion` | Para calcular vigencia |

### `ct_ips` — Prestadores

| Columna | Notas |
|---|---|
| `ips` | Código del prestador |
| `municipio` | ⚠️ Municipio de SEDE (no del contrato) — difiere en 33% de contratos |

---

## Relaciones Críticas

```
ct_ips_contrato.municipio_administracion → tb_municipio.municipio  ✅ CORRECTO
ct_ips.municipio                         → tb_municipio.municipio  ⚠️ Solo para sede del prestador

tb_municipio.departamento → tb_municipio.municipio (self-join para nombre del depto.)

tb_tarifario_propio_detalle.codigo_tarifa → tb_cup.codigo_interno        (servicios)
tb_tarifario_propio_detalle.codigo_tarifa → tb_medicamento.codigo_interno (medicamentos)
tb_tarifario_propio_detalle.codigo_tarifa → tb_insumo.codigo_interno      (insumos)
```

> **Por qué no FK físicas hacia tablas SIE:** este proyecto tiene acceso de solo lectura sobre esas tablas y no controla su ciclo de vida ni su esquema.

---

## Índices Recomendados (no creados)

| Tabla | Índice sugerido |
|---|---|
| `negociacion_contratacion_snapshot_tarifario` | `(codigo, fecha_snapshot)` |
| `negociacion_contratacion_consumo_agregado` | `(prestador, codigo, periodo)` |
| `negociacion_contratacion_indicador_cache` | `(nombre_indicador)` UNIQUE |
| `negociacion_contratacion_log_auditoria` | `(usuario_id, fecha)` |

> ⚠️ Las tablas fuente `rips_ap`/`rips_am`/`rips_at` no tienen índice sobre código/fecha para este caso de uso. Por eso siempre se filtra vía `consecutivo_rips` desde `rips_af`.

---

## Segmentadores Verificados como NO Viables

| Segmentador | Motivo |
|---|---|
| Especialidad | `consecutivo_especialidad_nt` NULL en >99,9% de `tb_cup` |
| Grupo CUPS | `consecutivo_grupo_nt` NULL en el 100% de `tb_cup` |
| Grupo CUPS (alterno) | `tb_cup.grupo` (smallint): 99,5% de filas con valor 1 |
| Grupo CUM | `tb_medicamento.grupo_medicamento`: 100% "No Aplica" |
| Familia de insumos | `tb_insumo` no tiene columna equivalente |
