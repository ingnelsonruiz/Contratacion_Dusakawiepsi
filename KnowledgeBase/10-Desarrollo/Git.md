---
tags: [desarrollo, git, control-versiones]
---

# Git

## Estado actual

> [!note]
> No se detectó carpeta `.git` accesible en este análisis ni un `CONTRIBUTING.md` con reglas explícitas de flujo de ramas/commits. Esta sección documenta lo que se puede inferir del `.gitignore` y recomienda un flujo estándar mientras el equipo defina uno propio.

## `.gitignore` actual

```
/node_modules
/.next/
/out/
.env
.env.local
*.tsbuildinfo
next-env.d.ts
```

Cubre dependencias, build de Next.js, variables de entorno sensibles y archivos generados de TypeScript — correcto y suficiente para el estado actual del proyecto.

## Flujo recomendado (mientras no haya uno documentado oficialmente)

- **Una fase del [[Roadmap]] = una rama/PR**, dado que el propio `docs/ARQUITECTURA.md` exige que "cada módulo se construya completo antes de iniciar el siguiente". Esto se alinea naturalmente con ramas por fase (`feature/modulo-1-tarifario`, etc.).
- **Commits que referencien la fase y el archivo de arquitectura** cuando se tome una decisión nueva, para mantener `docs/ARQUITECTURA.md` como "documento vivo" sincronizado con el código.
- **Migraciones SQL versionadas junto al código** que las usa, en el mismo commit/PR (ya es el patrón: `001_negociacion_contratacion_usuario.sql` se agregó junto con `auth.ts`/`auth-actions.ts`).

## Ver también
- [[Convenciones]]
- [[Buenas Prácticas]]
- [[Roadmap]]
