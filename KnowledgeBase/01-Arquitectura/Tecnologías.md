---
tags: [arquitectura, stack, tecnologias]
---

# Tecnologías

Stack **idéntico al resto de proyectos Dusakawi, sin excepciones** (decisión explícita de arquitectura, para que el equipo no reaprenda nada entre proyectos).

## Stack confirmado (en uso)

| Capa | Tecnología | Versión | Notas |
|---|---|---|---|
| Framework | Next.js (App Router) | 15.2.8 | `ignoreBuildErrors`/`ignoreDuringBuilds` activos mientras el proyecto está en construcción incremental — ver [[Buenas Prácticas]] |
| UI | React | 18.3.1 | |
| Lenguaje | TypeScript | ^5, `strict: true` | Ver `tsconfig.json` |
| Estilos | Tailwind CSS | 3.4.1 | + `tailwindcss-animate` |
| Componentes | Shadcn UI (Radix) | `@radix-ui/react-label`, `@radix-ui/react-slot`, `@radix-ui/react-tabs` ✅ | `badge`, `button`, `card`, `input`, `label`, `select` (nativo), `table` (Tailwind puro), `tabs` (Radix) |
| Utilidades CSS | `clsx` + `tailwind-merge` | — | Helper `cn()` en `src/lib/utils.ts` |
| Formularios | `react-hook-form` + `@hookform/resolvers` + `zod` | — | Dependencias instaladas; el login actual usa `useState` simple, no `react-hook-form` todavía |
| Iconos | `lucide-react` | 0.475.0 | Ver `modularizeImports` en `next.config.ts` — bug conocido con la optimización automática de Next, ver [[Soluciones#9. Forzar import explícito de lucide-react (modularizeImports)]] |
| Exportación Excel | `exceljs` ✅ | 4.4.0 | En uso desde el Módulo 1 (`src/lib/negociacion/exportar.ts`, `/api/export/tarifario`) |
| Base de datos | PostgreSQL 14.19 | — | Vía proxy HTTP, **sin ORM** |
| Ejecución de scripts | `tsx` | 4.19.2 | Para `scripts/seed-admin.ts` |
| Runtime | Node.js | 20 (`engines.node`) | |

## Stack planificado (no instalado aún)

| Necesidad | Tecnología propuesta | Módulo que la requiere |
|---|---|---|
| Visualización de datos | Recharts | Módulos 2-7 (ya usado en el resto del ecosistema, evita dependencia nueva) |
| Exportación PDF | jsPDF + autotable | Exportaciones (transversal) — el Módulo 1 solo exporta Excel/CSV + impresión del navegador |

## Por qué "sin ORM"

Mismo patrón que `Proyecto_Dusakawi`: SQL nativo parametrizado (`$1, $2…`) vía `executeQuery()` en [[Middleware#src/lib/db.ts|src/lib/db.ts]]. Decisión consciente para mantener consistencia entre proyectos del ecosistema y control total sobre queries de agregación pesadas.

## Configuración relevante

- `next.config.ts`: `typescript.ignoreBuildErrors: true` y `eslint.ignoreDuringBuilds: true` — el build no falla por errores de tipos/lint mientras se construye por fases.
- `tsconfig.json`: alias `@/*` → `./src/*`, `strict: true`.
- Puerto de desarrollo: **9010** (`next dev -p 9010`), por convención de puertos del ecosistema (`Proyecto_Dusakawi` usa 9002).

## Ver también
- [[Arquitectura General]]
- [[Patrones]]
- [[Convenciones]]
