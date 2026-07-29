---
tags: [indice, home, moc]
---

# KnowledgeBase — Contratacion_dusakawiepi

> [!info] Qué es esto
> Base de conocimiento navegable (formato Obsidian) del **Sistema de Inteligencia de Precios para Negociación de Contratos** — DUSAKAWI EPSI. Segundo cerebro del proyecto: cualquier desarrollador debería poder entender el sistema completo leyendo estos documentos, sin preguntar al equipo.

> [!warning] Estado real del proyecto (actualizado 2026-07-28)
> **Fase 0 — Fundación** ✅ y **Módulo 1 — Tarifario Vigente e Histórico** ✅ están implementados y en uso con datos reales de ARYUWIS (`/tarifarios` y `/tarifarios/[id]`). Los **7 módulos de análisis restantes** (Comparativo, Consumo, Sobrecostos, Simulador, Benchmark, Dashboard, Administración) siguen **diseñados y documentados** en `docs/ARQUITECTURA.md`, pero **no implementados en código todavía**. Cada documento de esta base distingue explícitamente entre "lo que existe" y "lo planificado".
>
> El Módulo 1 se implementó **sin el ETL de snapshot** originalmente planificado en `docs/ARQUITECTURA.md` §3: consulta la BD de ARYUWIS **en vivo** en cada carga (contratos + tarifarios ya vienen razonablemente acotados por contrato, no requirieron pre-agregación todavía). El ETL de snapshot histórico sigue pendiente si se necesita comparar tarifarios entre períodos — ver [[Pendientes]].

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
