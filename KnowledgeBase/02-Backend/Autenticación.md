---
tags: [backend, autenticacion, seguridad]
---

# Autenticación

## Propósito
Autenticar usuarios del Área de Contratación contra una tabla propia (`negociacion_contratacion_usuario`), independiente de ARYUWIS, con sesión basada en cookie httpOnly.

## Responsabilidad
- Verificar credenciales (`loginAction`).
- Crear/leer/destruir la sesión (`createSession` / `getSession` / `destroySession`).
- Autorizar por rol (`tieneRolMinimo`).

## Archivos involucrados
- `src/lib/auth.ts` — núcleo de sesión, hash, roles.
- `src/app/actions/auth-actions.ts` — Server Actions `loginAction`/`logoutAction`.
- `src/middleware.ts` — protección de rutas por cookie.
- `src/app/login/login-form.tsx` — UI del formulario.
- `db/migrations/001_negociacion_contratacion_usuario.sql` — tabla de usuarios.

## Modelo de sesión

```ts
export interface Session {
  isLoggedIn: true;
  userId: number;
  username: string;
  nombreCompleto: string;
  rol: Rol; // "analista" | "jefe_contratacion" | "admin"
}
```

- Cookie: `negociacion_contratacion_session`.
- `httpOnly: true`, `secure` en producción, `sameSite: "lax"`, `path: "/"`.
- **Duración**: 8 horas (`SESSION_MAX_AGE_SECONDS = 8 * 60 * 60`) — jornada laboral.
- Contenido: JSON plano de `Session`, sin firma criptográfica (JWT no se usa).

## Hash de contraseña

```ts
export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
```

Mismo patrón que `administrativo.usuarios_tarifario` en `Proyecto_Dusakawi` — consistencia del ecosistema, sin sal (salt) explícita. Ver riesgo documentado en [[Problemas Comunes]].

## Jerarquía de roles

```ts
export function tieneRolMinimo(session: Session | null, rolMinimo: Rol): boolean {
  if (!session) return false;
  const orden: Rol[] = ["analista", "jefe_contratacion", "admin"];
  return orden.indexOf(session.rol) >= orden.indexOf(rolMinimo);
}
```

| Rol | Nivel | Puede lo que puede... |
|---|---:|---|
| `analista` | 0 | Analista de Contratación (nivel base) |
| `jefe_contratacion` | 1 | Jefe de Contratación (incluye todo lo de analista) |
| `admin` | 2 | Administrador (incluye todo lo anterior) |

> [!warning] Función definida, uso pendiente
> `tieneRolMinimo()` existe pero **ningún Server Action ni página la invoca todavía** — no hay rutas que requieran un rol distinto de "estar logueado". Se activará cuando exista el Módulo 8 (Administración) y acciones sensibles en otros módulos.

## Flujo de ejecución
Ver diagrama de secuencia completo en [[Flujo Login]] y [[Servicios#Flujo de ejecución (login, caso implementado)]].

## Ejemplo de uso

```ts
// En una Server Action que requiera rol mínimo (patrón a aplicar quando exista):
const session = await getSession();
if (!tieneRolMinimo(session, "jefe_contratacion")) {
  return { success: false, error: "No autorizado." };
}
```

## Problemas conocidos
- Sin rate limiting / bloqueo por intentos fallidos.
- Hash SHA-256 sin sal — vulnerable a rainbow tables si la BD se filtra. Ver [[Problemas Comunes]].
- No hay recuperación de contraseña (self-service) — el reseteo depende de `scripts/seed-admin.ts` o de acceso directo a BD.

## Posibles mejoras
- Migrar a `bcrypt`/`argon2` con sal, manteniendo compatibilidad retro con hashes SHA-256 existentes durante una migración gradual.
- Agregar tabla `negociacion_contratacion_log_auditoria` para registrar cada login/logout (planificada, ver [[Tablas]]).
- Middleware podría validar expiración explícita además de confiar en `maxAge` de la cookie.

## Ver también
- [[Middleware]]
- [[Servicios]]
- [[Flujo Login]]
- [[Contratación]]
