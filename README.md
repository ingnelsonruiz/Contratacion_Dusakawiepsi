# Sistema de Inteligencia de Precios para Negociación de Contratos — DUSAKAWI EPSI

Plataforma de inteligencia de negocios para el Área de Contratación: análisis, comparación
y generación de información estratégica sobre tarifas CUPS, CUM, medicamentos e insumos
usados en la negociación de contratos con la red prestadora.

Proyecto independiente de `Proyecto_Dusakawi`, mismo stack y misma base de datos
(`base_sie_dusakawi`, esquema `administrativo`). Ver arquitectura completa en
[`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md).

## Estado actual: Fase 0 — Fundación

- [x] Scaffold Next.js 15 + TypeScript + Tailwind + Shadcn UI
- [x] `src/lib/db.ts` — proxy PostgreSQL (mismo patrón que Proyecto_Dusakawi)
- [x] Migración `negociacion_contratacion_usuario` (script listo, **pendiente de aplicar** — ver abajo)
- [x] Middleware de sesión + login + server actions de autenticación
- [ ] Verificación de build (`npm install && npm run build`)

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completar PROXY_API_KEY
```

### 1. Aplicar la migración de base de datos

El agente que generó este scaffold **no pudo aplicar la migración** porque el conector de
solo lectura usado para análisis rechaza escrituras, y el entorno de ejecución no tiene
salida de red hacia el proxy. Debe aplicarse manualmente (DBeaver, psql, o el pipeline que
ya use el equipo para escribir en `base_sie_dusakawi`):

```
db/migrations/001_negociacion_contratacion_usuario.sql
```

Es idempotente (`CREATE TABLE IF NOT EXISTS`), se puede ejecutar varias veces sin riesgo.

### 2. Crear el primer usuario administrador

```bash
ADMIN_USERNAME=tu_usuario ADMIN_PASSWORD=tu_clave npm run seed:admin
```

### 3. Levantar el servidor de desarrollo

```bash
npm run dev
```

Por convención de puertos del ecosistema Dusakawi (Proyecto_Dusakawi usa 9002), este
proyecto usa el puerto **9010** (`http://localhost:9010`).

## Principios de este repositorio

- **Solo lectura** sobre las tablas de `base_sie_dusakawi` fuera de las creadas por este
  proyecto. Toda tabla nueva lleva el prefijo `negociacion_contratacion_`.
- Sin ORM — SQL nativo parametrizado, mismo patrón que el resto del ecosistema.
- Cada módulo funcional (ver `docs/ARQUITECTURA.md`, sección 4) se construye completo
  antes de iniciar el siguiente.
