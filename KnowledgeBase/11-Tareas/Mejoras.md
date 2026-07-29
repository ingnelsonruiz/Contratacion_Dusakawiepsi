---
tags: [tareas, mejoras, deuda-tecnica]
---

# Mejoras

Oportunidades de mejora identificadas durante el análisis, no bloqueantes para el funcionamiento actual.

## Seguridad

- [ ] Eliminar el fallback hardcodeado de `PROXY_API_KEY` en `src/lib/db.ts` (ver [[Soluciones#1. Eliminar el fallback hardcodeado de PROXY_API_KEY]]).
- [ ] Migrar hash de contraseña de SHA-256 sin sal a bcrypt/argon2 (ver [[Soluciones#3. Migrar a un hash con sal]]).
- [ ] Agregar rate limiting a `loginAction` (ver [[Soluciones#4. Rate limiting de login]]).
- [ ] Firmar criptográficamente la cookie de sesión (ver [[Soluciones#7. Firmar o validar la cookie de sesión contra el servidor]]).

## Calidad de código

- [ ] Migrar `LoginForm` a `react-hook-form` + `zod` (ya instalados como dependencia, sin usar) para validación de cliente consistente con el resto del ecosistema.
- [ ] Diferenciar el mensaje de error de "tabla no existe" vs. "proxy no disponible" en `loginAction` (ver [[Soluciones#6. Diferenciar errores de tabla inexistente vs. proxy caído]]).
- [ ] Introducir suite de pruebas automatizadas (Jest/Vitest para funciones puras de `src/lib/negociacion/`, cuando exista esa carpeta).

## Infraestructura

- [ ] Confirmar compatibilidad de `PROXY_TIMEOUT_MS = 90000` con el plan de hosting elegido antes del primer despliegue (ver [[Vercel]]).
- [ ] Definir si se necesita `Dockerfile`/`docker-compose.yml` o si el despliegue será 100% PaaS (Vercel/Render) sin contenedores.
- [ ] Documentar formalmente el flujo de ramas/commits en un `CONTRIBUTING.md` (ver [[Git]]).

## Producto (según `docs/ARQUITECTURA.md`)

- [ ] Extraer un helper `requireRole(rolMinimo)` reutilizable antes de que existan múltiples páginas que requieran autorización granular (ver [[Controladores#Posibles mejoras]]).
- [ ] Extraer las tarjetas de módulo del dashboard a un componente `ModuloCard` reutilizable cuando tengan contenido dinámico real.

## Ver también
- [[Problemas Comunes]]
- [[Soluciones]]
- [[Pendientes]]
- [[Bugs]]
