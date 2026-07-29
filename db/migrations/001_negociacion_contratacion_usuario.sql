-- Migración 001 — Sistema de Inteligencia de Precios para Negociación de Contratos
-- Tabla de usuarios propia del módulo (independiente de ARYUWIS/usuarios_tarifario).
-- Esquema: administrativo (mismo esquema del ecosistema SIE, por decisión del
-- Área de Contratación — ver docs/ARQUITECTURA.md, sección 7).
--
-- Idempotente (CREATE TABLE IF NOT EXISTS): se puede ejecutar varias veces sin riesgo.
-- IMPORTANTE: el conector de solo lectura usado para análisis (mcp postgres) NO puede
-- ejecutar esto. Debe aplicarse con credenciales de escritura sobre base_sie_dusakawi
-- (mismo proxy pg-proxy.onrender.com que usa la app en runtime, o directamente por un
-- DBA). Ver intento de aplicación y resultado documentado en el chat/README.

BEGIN;

CREATE TABLE IF NOT EXISTS administrativo.negociacion_contratacion_usuario (
    id                BIGSERIAL PRIMARY KEY,
    username          VARCHAR(100) NOT NULL UNIQUE,
    nombre_completo    VARCHAR(200) NOT NULL,
    password_hash     VARCHAR(64)  NOT NULL, -- SHA-256 hex (mismo patrón que administrativo.usuarios_tarifario)
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

COMMENT ON TABLE administrativo.negociacion_contratacion_usuario IS
    'Usuarios del Sistema de Inteligencia de Precios para Negociación de Contratos (Área de Contratación). Independiente de usuarios_tarifario/ARYUWIS.';

COMMIT;
