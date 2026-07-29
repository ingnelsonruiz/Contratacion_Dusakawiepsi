---
tags: [desarrollo, buenas-practicas]
---

# Buenas Prácticas

## Ya aplicadas en el código actual

- **Server Actions tipadas** con contrato `{ success, error? }` consistente (`LoginResult`).
- **SQL parametrizado siempre**, nunca interpolación (ver [[Convenciones#SQL]]).
- **Defensa en profundidad**: el middleware protege rutas, y el layout `(protegido)` vuelve a validar sesión, sin asumir que todo request pasó por el middleware.
- **Manejo explícito de cold-start vs. timeout real** en el proxy de BD, en vez de un reintento ciego (ver [[Patrones]]).
- **Auditoría mínima no bloqueante**: si falla el `UPDATE ultimo_login`, no se bloquea el login exitoso — un efecto secundario no crítico no debe romper el flujo principal.
- **Idempotencia en migraciones y en el seed de admin** (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT ... DO UPDATE`).

## Pendientes de aplicar (deuda técnica conocida)

Ver detalle en [[Problemas Comunes]] y [[Soluciones]]:

1. Eliminar el fallback hardcodeado de `PROXY_API_KEY`.
2. Migrar el hash de contraseña a un esquema con sal (bcrypt/argon2).
3. Agregar rate limiting al login.
4. Confirmar compatibilidad de timeouts con el plan de hosting antes de desplegar (Vercel).

## Sobre `ignoreBuildErrors` / `ignoreDuringBuilds`

`next.config.ts` desactiva el bloqueo de build por errores de TypeScript/ESLint, **de forma intencional** mientras el proyecto se construye incrementalmente por fases (mismo patrón que `Proyecto_Dusakawi`). Esto es una decisión consciente de velocidad de desarrollo, no un descuido — pero implica que `npm run typecheck` y `npm run lint` deben ejecutarse **manualmente** antes de cada entrega, ya que el build no los hará por el equipo.

> [!important] Checklist antes de cada PR
> - [ ] `npm run typecheck` sin errores nuevos
> - [ ] `npm run lint` sin errores nuevos
> - [ ] `npm run build` exitoso
> - [ ] Si se agregó una tabla: migración idempotente en `db/migrations/`
> - [ ] Si se agregó una regla de negocio: función pura en `src/lib/negociacion/` con caso de prueba manual documentado

## Testing

> [!warning]
> No hay suite de pruebas automatizadas (unitarias/integración) configurada todavía — ni Jest, ni Vitest, ni Playwright en `package.json`. El README menciona "pruebas manuales de datos reales" como criterio de cierre de cada fase, no pruebas automatizadas. Ver oportunidad de mejora en [[Mejoras]].

## Ver también
- [[Convenciones]]
- [[Problemas Comunes]]
- [[Soluciones]]
- [[Mejoras]]
