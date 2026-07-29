---
tags: [desarrollo, convenciones, estilo]
---

# Convenciones

## Nomenclatura

| Elemento | Convención | Ejemplo |
|---|---|---|
| Tablas nuevas | `negociacion_contratacion_` + snake_case descriptivo | `negociacion_contratacion_usuario` |
| Server Actions | `<dominio>-actions.ts`, funciones `verboSustantivo` | `loginAction`, `logoutAction` |
| Componentes React | PascalCase, un componente por archivo | `LoginForm`, `LogoutButton` |
| Migraciones SQL | `db/migrations/NNN_descripcion_corta.sql` | `001_negociacion_contratacion_usuario.sql` |
| Rutas protegidas | Grupo `(protegido)` del App Router | `src/app/(protegido)/dashboard/` |
| Alias de import | `@/*` → `./src/*` | `import { pool } from "@/lib/db"` |

## Idioma

Código, comentarios y mensajes de usuario **en español** (consistente con todo el ecosistema Dusakawi). Nombres de variables/funciones técnicas siguen convención en español cuando describen dominio de negocio (`usuario_grabado`, `fecha_grabado`, `rolMinimo`) e inglés para conceptos puramente técnicos (`Session`, `pool`, `executeQuery`).

## SQL

- **Siempre parametrizado** (`$1, $2, …`) — nunca interpolación de string en el SQL.
- Cada query relevante lleva un `source` descriptivo (ej. `"auth/login"`, `"auth/ultimo-login"`) para trazabilidad en `pg_stat_activity`.
- Migraciones idempotentes (`CREATE TABLE/INDEX IF NOT EXISTS`) siempre que sea razonable.

```ts
// Patrón correcto
await pool.query(
  `SELECT id FROM administrativo.negociacion_contratacion_usuario WHERE username = $1`,
  [usuario],
  "auth/login"
);
```

## Server Actions

- Un archivo por dominio funcional, nunca un archivo gigante de acciones mezcladas (lección aprendida del `db-actions.ts` legado con 14 funciones).
- Retornar siempre un objeto tipado con `success: boolean` y `error?: string` para manejo de errores predecible en el cliente.

## Componentes

- Client Components (`"use client"`) solo cuando se necesita interactividad (`useState`, `useTransition`, event handlers). Todo lo demás, Server Component por defecto.
- Usar `useTransition` + Server Action para cualquier acción que implique espera de red, mostrando estado `isPending`.

## Lógica de negocio

- Toda regla de cálculo (umbrales, semáforos, fórmulas de ahorro) debe ser una función pura en `src/lib/negociacion/` (carpeta a crear en Fase 1), nunca inline en un `.tsx`.

## Ver también
- [[Buenas Prácticas]]
- [[Patrones]]
- [[Git]]
