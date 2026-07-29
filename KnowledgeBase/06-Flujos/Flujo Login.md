---
tags: [flujos, login, autenticacion]
---

# Flujo Login

## Diagrama de secuencia completo

```mermaid
sequenceDiagram
    actor U as Usuario
    participant MW as middleware.ts
    participant LP as /login (Server Component)
    participant LF as LoginForm (Client)
    participant SA as loginAction (Server Action)
    participant Auth as lib/auth.ts
    participant DB as lib/db.ts (proxy)
    participant Cookie as Cookie httpOnly

    U->>MW: GET /dashboard (sin cookie de sesión)
    MW-->>U: Redirect a /login?callbackUrl=/dashboard
    U->>LP: GET /login
    LP-->>U: Renderiza LoginForm
    U->>LF: Ingresa username + password, submit
    LF->>SA: loginAction(username, password)
    SA->>Auth: sha256Hex(password)
    SA->>DB: SELECT id, username, nombre_completo, rol, activo<br/>WHERE username=$1 AND password_hash=$2
    DB-->>SA: rows

    alt Usuario y clave vacíos
        SA-->>LF: { success: false, error: "Usuario y clave son obligatorios." }
    else Error de conexión/tabla no existe
        SA-->>LF: { success: false, error: "No fue posible validar..." }
    else Usuario no encontrado o clave incorrecta
        SA-->>LF: { success: false, error: "Usuario o clave incorrectos." }
    else Usuario inactivo
        SA-->>LF: { success: false, error: "El usuario existe pero está inactivo..." }
    else Login exitoso
        SA->>Auth: createSession({ isLoggedIn: true, userId, username, nombreCompleto, rol })
        Auth->>Cookie: Set-Cookie negociacion_contratacion_session (httpOnly, 8h)
        SA->>DB: UPDATE ultimo_login = now() (no bloqueante)
        SA-->>LF: { success: true }
        LF->>U: router.push(callbackUrl || "/dashboard") + router.refresh()
    end
```

## Pasos narrados

1. Un usuario no autenticado intenta acceder a una ruta protegida (ej. `/dashboard`).
2. `middleware.ts` detecta ausencia/invalidez de la cookie `negociacion_contratacion_session` y redirige a `/login`, preservando la ruta original en `callbackUrl`.
3. El usuario completa el formulario (`LoginForm`, Client Component) y envía.
4. `loginAction` (Server Action) hashea la clave con SHA-256 y consulta `administrativo.negociacion_contratacion_usuario`.
5. Según el resultado, retorna éxito o uno de los 4 mensajes de error posibles (ver [[API#Endpoint actual: Server Action de autenticación]]).
6. En éxito: se crea la cookie de sesión (8 horas de duración), se actualiza `ultimo_login` (no bloqueante) y el cliente navega a `callbackUrl` o `/dashboard`.
7. El layout `(protegido)/layout.tsx` vuelve a validar la sesión (defensa en profundidad) antes de renderizar el contenido.

## Archivos involucrados
`src/middleware.ts`, `src/app/login/page.tsx`, `src/app/login/login-form.tsx`, `src/app/actions/auth-actions.ts`, `src/lib/auth.ts`, `src/lib/db.ts`, `src/app/(protegido)/layout.tsx`.

## Flujo de logout (complementario)

```mermaid
sequenceDiagram
    actor U as Usuario
    participant LB as LogoutButton (Client)
    participant SA as logoutAction (Server Action)
    participant Cookie as Cookie httpOnly

    U->>LB: Click "Salir"
    LB->>SA: logoutAction()
    SA->>Cookie: destroySession() — elimina cookie
    SA-->>LB: void
    LB->>U: router.push("/login") + router.refresh()
```

## Ver también
- [[Autenticación]]
- [[Servicios]]
- [[Componentes]]
