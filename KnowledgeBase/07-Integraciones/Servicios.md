---
tags: [integraciones, servicios, ecosistema]
---

# Servicios del ecosistema Dusakawi

## Relación con `Proyecto_Dusakawi`

`Contratacion_dusakawiepi` es un **proyecto independiente** (código, repositorio y deploy propios) que comparte:

- La **misma base de datos física** (`base_sie_dusakawi`, esquema `administrativo`) — ver [[Decisiones ADR#ADR-001]].
- El **mismo proxy de base de datos** (`pg-proxy.onrender.com`) — diferenciado por el campo `source` en cada query.
- El **mismo stack tecnológico** (Next.js 15, Tailwind, Shadcn) — para que el equipo no reaprenda nada entre proyectos.
- La **misma convención de autenticación** (cookie de sesión + hash SHA-256), aunque con tabla de usuarios propia e independiente de `usuarios_tarifario`/ARYUWIS.

| Servicio compartido | Proyecto_Dusakawi | Contratacion_dusakawiepi |
|---|---|---|
| Puerto de desarrollo | 9002 | 9010 |
| Base de datos | `base_sie_dusakawi` | `base_sie_dusakawi` (misma) |
| Proxy de BD | pg-proxy.onrender.com | pg-proxy.onrender.com (mismo) |
| Tabla de usuarios | `usuarios_tarifario` (ARYUWIS) | `negociacion_contratacion_usuario` (propia) |

## Servicio de sesión

No hay servicio externo de identidad (sin NextAuth, sin Supabase Auth, sin SSO corporativo integrado). La sesión es 100% autónoma vía cookie httpOnly — ver [[Autenticación]].

## Sin microservicios propios

Este proyecto no expone ni consume microservicios internos propios más allá del proxy de BD compartido. El ETL planificado (Módulo transversal) correrá como Route Handlers dentro de la misma aplicación Next.js (`/api/etl/*`), no como un servicio separado.

## Ver también
- [[APIs Externas]]
- [[Webhooks]]
- [[Arquitectura General]]
