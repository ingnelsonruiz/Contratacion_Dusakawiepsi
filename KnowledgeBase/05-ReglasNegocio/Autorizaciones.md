---
tags: [reglas-negocio, autorizaciones, roles]
---

# Reglas de Negocio — Autorizaciones (control de acceso)

> [!note] Alcance de este documento
> `Contratacion_dusakawiepi` **no gestiona autorizaciones médicas/administrativas de servicios de salud** (eso es un dominio de otros sistemas del ecosistema Dusakawi). Aquí "autorizaciones" se documenta en el sentido de **control de acceso y permisos por rol** dentro de esta aplicación.

## Roles definidos

| Rol | Nivel jerárquico | Descripción |
|---|---:|---|
| `analista` | 0 | Analista de Contratación — rol base, acceso a consulta de módulos de análisis |
| `jefe_contratacion` | 1 | Jefe de Contratación — incluye todo lo del analista |
| `admin` | 2 | Administrador — incluye todo lo anterior + gestión de usuarios/auditoría |

Implementado en `src/lib/auth.ts` → `tieneRolMinimo(session, rolMinimo)`. Ver [[Autenticación#Jerarquía de roles]].

## Reglas de autorización actuales

| Acción | Requiere sesión | Requiere rol mínimo |
|---|---|---|
| Ver `/dashboard` | Sí (validado por middleware + layout) | Ninguno (cualquier rol autenticado) |
| Login / Logout | No | No aplica |

> [!warning] Sin autorización granular todavía
> Hoy **ninguna acción distingue por rol** más allá de "estar autenticado o no". La función `tieneRolMinimo()` existe pero no se invoca en ningún flujo real. Se activará cuando existan acciones sensibles (ej. Módulo 8 — Administración, exportaciones, cambios de escenario en el Simulador).

## Reglas de autorización planificadas

| Módulo | Regla planificada |
|---|---|
| Módulo 5 — Simulador | Crear/editar un escenario de negociación probablemente requiera rol `jefe_contratacion` o superior (a confirmar con el Área de Contratación) |
| Módulo 8 — Administración | Gestión de usuarios y exclusiones de calidad de datos requiere rol `admin` |
| Transversal | Toda exportación y cambio de escenario debe auditarse en `negociacion_contratacion_log_auditoria` (ver [[Objetivos#Principios no negociables]]) — es información que se usa para negociar contratos multimillonarios |

## Ver también
- [[Autenticación]]
- [[Validaciones]]
- [[Diagramas#Casos de uso por rol]]
