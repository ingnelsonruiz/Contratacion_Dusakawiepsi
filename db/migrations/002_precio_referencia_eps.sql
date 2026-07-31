-- Migración 002 — Sistema de Inteligencia de Precios para Negociación de Contratos
-- Tabla de precios de referencia reportados por OTRAS EPS (mercado externo), para
-- comparar contra la propuesta de un prestador y para citarlos en la negociación
-- ("Análisis de Propuesta Prestador", ver KnowledgeBase/05-ReglasNegocio/Contratación.md).
-- Esquema: administrativo (mismo esquema del ecosistema SIE, por decisión del
-- Área de Contratación — ver docs/ARQUITECTURA.md, sección 7).
--
-- Alcance vs. la tabla "negociacion_contratacion_benchmark_mercado" ya planificada en
-- KnowledgeBase/04-BaseDatos/Tablas.md: esa quedó reservada para fuentes públicas de
-- ingesta batch (SISMED/datos.gov.co/ISS 2001); esta tabla es una fuente distinta —
-- precios que OTRAS EPS pagan a prestadores, cargados manualmente por el analista vía
-- archivo (CSV/TXT/XLSX) desde la UI del módulo — con su propio ciclo de vida (se
-- alimenta/actualiza cuando el analista recibe información nueva del mercado).
--
-- Idempotente (CREATE TABLE IF NOT EXISTS): se puede ejecutar varias veces sin riesgo.
-- IMPORTANTE: el conector de solo lectura usado para análisis (mcp postgres) NO puede
-- ejecutar esto. Debe aplicarse con credenciales de escritura sobre base_sie_dusakawi
-- (mismo proxy pg-proxy.onrender.com que usa la app en runtime, o directamente por un
-- DBA) antes de que el módulo "Precios de Referencia EPS" pueda cargar/consultar datos.

BEGIN;

CREATE TABLE IF NOT EXISTS administrativo.negociacion_contratacion_precio_referencia_eps (
    id                  BIGSERIAL PRIMARY KEY,
    -- "Nit_prestador"/"Prestador" son los nombres de columna del archivo fuente que
    -- entrega el analista, pero identifican a la EPS/entidad pagadora de referencia
    -- (ej. "Asmet Salud EPS"), NO a un prestador/IPS de la red de Dusakawi.
    nit_entidad         VARCHAR(20)   NOT NULL,
    nombre_entidad      VARCHAR(200)  NOT NULL,
    -- Código DANE (administrativo.tb_municipio.municipio), resuelto en la carga a
    -- partir del texto libre de la columna "Municipio" del archivo (ver
    -- src/app/actions/precio-referencia-eps-actions.ts, resolverMunicipioPorNombre).
    municipio_codigo    VARCHAR(10)   NOT NULL,
    -- Texto tal como venía en el archivo original — se conserva para auditoría/
    -- trazabilidad, aunque la dimensión de cruce real es municipio_codigo.
    municipio_nombre    VARCHAR(150)  NOT NULL,
    codigo              VARCHAR(50)   NOT NULL,
    descripcion         TEXT          NOT NULL,
    precio              NUMERIC(14,2) NOT NULL,
    usuario_grabado     VARCHAR(100),
    fecha_grabado       TIMESTAMP     NOT NULL DEFAULT now(),
    fecha_actualizado   TIMESTAMP     NOT NULL DEFAULT now(),
    CONSTRAINT chk_negociacion_contratacion_precio_referencia_eps_precio
        CHECK (precio > 0),
    -- Una fila por combinación EPS + municipio + código: cargar el mismo archivo (o
    -- una versión corregida) más de una vez ACTUALIZA el precio en vez de duplicar
    -- la fila (UPSERT, ver cargarPreciosReferenciaEps en precio-referencia-eps-actions.ts).
    CONSTRAINT uq_negociacion_contratacion_precio_referencia_eps
        UNIQUE (nit_entidad, municipio_codigo, codigo)
);

-- Cruce principal del módulo: "para este código, en este municipio, ¿alguna EPS
-- reportó un precio?" (usado por Análisis de Propuesta Prestador).
CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_precio_ref_eps_municipio_codigo
    ON administrativo.negociacion_contratacion_precio_referencia_eps (municipio_codigo, codigo);

-- Filtro de la pantalla de administración del módulo (ver/depurar la carga de una EPS puntual).
CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_precio_ref_eps_entidad
    ON administrativo.negociacion_contratacion_precio_referencia_eps (nit_entidad);

COMMENT ON TABLE administrativo.negociacion_contratacion_precio_referencia_eps IS
    'Precios de referencia que OTRAS EPS pagan a prestadores por código (CUPS/CUM/insumo), cargados manualmente por el analista de Contratación vía archivo. Usado como referencia adicional de mercado en el módulo "Análisis de Propuesta Prestador" — no se mezcla con la mediana/promedio de la red propia de Dusakawi, se muestra y exporta por separado.';

COMMIT;
