---
tags: [indice, home, moc]
---

# KnowledgeBase — Contratacion_dusakawiepi

> [!info] Qué es esto
> Base de conocimiento navegable (formato Obsidian) del **Sistema de Inteligencia de Precios para Negociación de Contratos** — DUSAKAWI EPSI. Segundo cerebro del proyecto: cualquier desarrollador debería poder entender el sistema completo leyendo estos documentos, sin preguntar al equipo.

> [!warning] Estado real del proyecto (actualizado 2026-08-02)
> **Fase 0 — Fundación** ✅ y **4 de los 8 módulos originales** están implementados y en producción con datos reales de ARYUWIS/RIPS: **Módulo 1 — Tarifario Vigente e Histórico** (`/tarifarios`), **Módulo 2 — Comparativo entre Prestadores** (`/comparativo`, incluye la pestaña "Dashboard Analítico de Riesgo Contractual"), **Módulo 3 — Comparativo Histórico del Prestador** MVP (`/historico-prestador`) y **Módulo 4 — Consumo y Frecuencia** MVP (`/consumo-frecuencia`). Además, el equipo construyó **4 módulos nuevos que NO estaban en los 8 originales de `docs/ARQUITECTURA.md`**, todos ya en producción: **Perfil Competitivo del Prestador** (`/perfil-prestador`), **Análisis de Códigos de Mayor Impacto Económico** (`/top-impacto`), **Análisis de Propuesta del Prestador** (`/analisis-propuesta`) y **Precios de Referencia de Otras EPS** (`/precio-referencia-eps`). Quedan sin implementar: **Módulo 5 — Simulador de Escenarios**, **Módulo 6 — Benchmark de Mercado Externo** (diferido a Fase 6 a propósito) y **Módulo 8 — Administración** (solo existe la tabla de usuarios). El **Módulo 7 — Dashboard Ejecutivo** sigue siendo un placeholder visual en `/dashboard`. Ver el detalle módulo a módulo, con fecha de cada hito, en [[Roadmap]] y [[Contratación]] — son las fuentes más actualizadas de esta base.
>
> El Módulo 1 se implementó **sin el ETL de snapshot** originalmente planificado en `docs/ARQUITECTURA.md` §3: consulta la BD de ARYUWIS **en vivo** en cada carga (contratos + tarifarios ya vienen razonablemente acotados por contrato, no requirieron pre-agregación todavía). El ETL de snapshot histórico sigue pendiente si se necesita comparar tarifarios entre períodos — ver [[Pendientes]]. Los Módulos 3 y 4 tampoco usan ETL: consultan RIPS en vivo con un patrón de rendimiento validado (filtrar primero la tabla chica `rips_af`, saltar a las tablas grandes por `consecutivo_rips` indexado) — ver [[Contratación]].
>
> ⚠️ **Dos tablas propias con DDL escrito pero aún NO aplicadas en la base de datos real**: `negociacion_contratacion_usuario` (bloqueante desde Fase 0) y `negociacion_contratacion_precio_referencia_eps` (bloqueante solo del módulo de Precios de Referencia EPS, aplicable desde la propia UI con el botón "Aplicar migración", rol `admin`). Ver [[Pendientes]] y [[Tablas]].

## Mapa de la base de conocimiento

### [[Visión General|00 · Proyecto]]
- [[Visión General]] — qué es el proyecto y por qué existe
- [[Objetivos]] — objetivo general y por módulo
- [[Roadmap]] — fases de construcción incremental

### [[Arquitectura General|01 · Arquitectura]]
- [[Arquitectura General]] — visión técnica completa
- [[Tecnologías]] — stack usado y planificado
- [[Patrones]] — patrones de diseño del código
- [[Decisiones ADR]] — decisiones de arquitectura registradas
- [[Diagramas]] — índice central de diagramas Mermaid

### [[API|02 · Backend]]
- [[API]] — Server Actions y endpoints (implementados y planificados)
- [[Servicios]] — lógica de servidor por dominio
- [[Controladores]] — Server Components que orquestan sesión y datos
- [[Middleware]] — protección de rutas y proxy de BD
- [[Autenticación]] — sesión, hash, roles

### [[Componentes|03 · Frontend]]
- [[Componentes]] — inventario de componentes React
- [[Páginas]] — rutas del App Router
- [[Hooks]] — hooks en uso
- [[Estados]] — manejo de estado local y de sesión

### [[Modelo ER|04 · Base de Datos]]
- [[Modelo ER]] — diagrama entidad-relación completo
- [[Tablas]] — tablas implementadas, planificadas y SIE existentes
- [[Relaciones]] — llaves foráneas y relaciones lógicas
- [[Índices]] — índices actuales y recomendados
- [[Procedimientos]] — ETL, funciones, vistas

### [[Contratación|05 · Reglas de Negocio]]
- [[Contratación]] — reglas de tarifas y negociación
- [[Autorizaciones]] — roles y control de acceso
- [[RCV]] — calidad y validación de datos
- [[Validaciones]] — validaciones implementadas y planificadas

### [[Flujo Login|06 · Flujos]]
- [[Flujo Login]] — secuencia completa de autenticación
- [[Flujo Registro]] — creación de usuarios
- [[Flujo Migración]] — aplicar cambios de esquema
- [[Flujo Facturación]] — consumo real (RIPS) vs. tarifas

### [[APIs Externas|07 · Integraciones]]
- [[APIs Externas]] — proxy de BD, SISMED, benchmark externo
- [[Servicios]] — relación con `Proyecto_Dusakawi` (ver también 07)
- [[Webhooks]] — disparo planificado del ETL

### [[Docker|08 · Deployment]]
- [[Docker]] — estado (no implementado) y propuesta de referencia
- [[Render]] — uso actual (proxy de BD)
- [[Vercel]] — candidato de hosting de la app
- [[Variables]] — variables de entorno

### [[Problemas Comunes|09 · Errores]]
- [[Problemas Comunes]] — riesgos y deuda técnica identificados
- [[Soluciones]] — mitigación propuesta para cada uno

### [[Convenciones|10 · Desarrollo]]
- [[Convenciones]] — nomenclatura y estilo
- [[Git]] — flujo de control de versiones
- [[Buenas Prácticas]] — checklist y prácticas aplicadas/pendientes

### [[Pendientes|11 · Tareas]]
- [[Pendientes]] — checklist de Fase 0 y bloqueantes
- [[Mejoras]] — deuda técnica y oportunidades
- [[Bugs]] — registro de bugs (plantilla)

### [[Glosario]]
Términos de dominio de salud, técnicos y roles del sistema.

## Cómo mantener esta base viva

> [!tip] Regla de oro
> Cuando el código cambie, **actualiza primero `docs/ARQUITECTURA.md`** (documento vivo original del proyecto) y luego refleja el cambio aquí. Si se implementa un módulo nuevo, actualiza su badge de estado (✅/⏳) en [[Roadmap]] y en [[Arquitectura General#4. Módulos funcionales]], y crea las páginas de detalle correspondientes en las carpetas ya existentes.

## Ver también
- Documento fuente original: `docs/ARQUITECTURA.md` (en la raíz del repositorio)
- `README.md` del repositorio (puesta en marcha técnica)
