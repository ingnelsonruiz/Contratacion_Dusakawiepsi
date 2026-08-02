-- Migración 003 — Jobs de análisis pesado en segundo plano (2026-08-02)
--
-- Origen: el módulo "Análisis de Códigos de Mayor Impacto Económico"
-- (/top-impacto) hacía esperar al navegador el resultado completo de 3
-- consultas SQL pesadas y SECUENCIALES (obtenerPorCodigo/obtenerPorPrestador/
-- obtenerPorMunicipio, cada una un UNION ALL sobre cientos de millones de
-- filas de RIPS) dentro de UNA sola invocación de Server Action. Con
-- filtros amplios (tipo="Todos" + municipio, sin prestador que acote) la
-- suma de las 3 consultas podía superar el tiempo de espera razonable del
-- navegador y el límite de la función serverless, mostrando el aviso "La
-- consulta está tardando más de lo esperado..." — ver
-- KnowledgeBase/09-Errores/Problemas Comunes.md #5b.
--
-- Esta tabla reemplaza el patrón "esperar toda la respuesta" por un patrón
-- de JOB asíncrono: se crea una fila aquí, se responde de inmediato al
-- navegador con el `codigo_job`, el cómputo real corre en segundo plano
-- (Next.js 15 `after()`, sin infraestructura externa tipo Redis/BullMQ —
-- ver diagnóstico entregado al usuario 2026-08-02) actualizando esta misma
-- fila etapa por etapa, y el cliente hace polling de su estado. Diseñada
-- para ser reutilizable por otros módulos pesados a futuro (columna
-- `modulo`), aunque hoy solo el módulo "top-impacto" la usa.
--
-- No hay procedimientos almacenados ni triggers — toda la lógica de
-- transición de estado vive en TypeScript
-- (src/lib/negociacion/analisis-job-store.ts), igual que el resto del
-- proyecto (ver CLAUDE.md / Principios no negociables).

BEGIN;

CREATE TABLE IF NOT EXISTS administrativo.negociacion_contratacion_analisis_job (
    id                    BIGSERIAL PRIMARY KEY,
    -- Código legible mostrado al usuario (ej. "AN-2026-000184"), asignado
    -- justo después del INSERT (necesita conocer `id` y el año). Único para
    -- poder consultarlo directamente desde el cliente sin exponer el `id`
    -- interno.
    codigo_job            VARCHAR(30) UNIQUE,
    -- Módulo dueño del job — hoy siempre 'top-impacto', pero se deja como
    -- columna (no hardcodeado) para que Consumo/Frecuencia, Dashboard de
    -- Riesgo u otro módulo pesado puedan reutilizar esta misma tabla más
    -- adelante sin una migración nueva.
    modulo                VARCHAR(40) NOT NULL,
    estado                VARCHAR(20) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente','procesando','completado','error')),
    progreso              SMALLINT NOT NULL DEFAULT 0 CHECK (progreso BETWEEN 0 AND 100),
    etapa                 VARCHAR(150),
    etapa_numero          SMALLINT,
    etapa_total           SMALLINT,
    -- Lista ordenada de etiquetas de etapa (ej. ["Preparando información",
    -- "Procesando servicios", ..., "Construyendo TOP 100 y rankings"]),
    -- calculada UNA vez al crear el job según los tipos seleccionados en el
    -- filtro — el cliente la usa para pintar el checklist ✓/🔄/○ sin
    -- duplicar la lógica de "qué etapas aplican" en el navegador.
    etapas                JSONB NOT NULL DEFAULT '[]'::jsonb,
    mensaje               TEXT,
    filtros               JSONB NOT NULL,
    -- Hash (sha256 de los filtros normalizados) usado para reutilizar un
    -- análisis reciente idéntico en vez de recalcularlo — ver
    -- `buscarJobReutilizable` en analisis-job-store.ts.
    filtros_hash          VARCHAR(64) NOT NULL,
    registros_procesados  BIGINT NOT NULL DEFAULT 0,
    -- Nace NULL a propósito: el total real de líneas de detalle a procesar
    -- no se conoce de forma barata antes de terminar (habría que escanear
    -- las mismas tablas pesadas que se busca evitar escanear dos veces).
    -- Se llena solo al completar, igual a `registros_procesados` final. El
    -- cliente oculta el "de N" mientras esta columna sea NULL, en vez de
    -- inventar un total — mismo criterio de "no barra de progreso falsa"
    -- pedido explícitamente por el usuario.
    total_registros       BIGINT,
    codigos_encontrados   INTEGER NOT NULL DEFAULT 0,
    resultado             JSONB,
    error                 TEXT,
    usuario               VARCHAR(100),
    rol                   VARCHAR(30),
    fecha_inicio          TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion   TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_finalizacion    TIMESTAMPTZ
);

-- Búsqueda de un job reutilizable (mismo módulo + mismos filtros, ya
-- completado, reciente) — ver VENTANA_REUTILIZACION_JOB_MINUTOS.
CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_analisis_job_reuso
    ON administrativo.negociacion_contratacion_analisis_job (modulo, filtros_hash, estado, fecha_finalizacion DESC);

-- Polling por código de job (además del UNIQUE, que ya crea su propio
-- índice — este es solo documentación de la intención de uso).
CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_analisis_job_codigo
    ON administrativo.negociacion_contratacion_analisis_job (codigo_job);

COMMENT ON TABLE administrativo.negociacion_contratacion_analisis_job IS
    'Jobs de análisis pesado en segundo plano (patrón crear-job + polling, sin Redis/BullMQ). Usado hoy por el módulo "Análisis de Códigos de Mayor Impacto Económico" (/top-impacto) para no bloquear al navegador con 3 consultas SQL secuenciales sobre RIPS completo. Reutilizable por otros módulos vía la columna `modulo`.';

COMMIT;
