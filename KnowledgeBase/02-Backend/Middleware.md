---
tags: [backend, middleware, sesion]
---

# Middleware

## Propósito
Proteger rutas de la aplicación redirigiendo a `/login` a cualquier request sin sesión válida, antes de que el Server Component correspondiente se ejecute.

## Archivo
`src/middleware.ts`

## Lógica

```ts
const SESSION_COOKIE = 'negociacion_contratacion_session';

export async function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  let isLoggedIn = false;
  if (sessionCookie) {
    try {
      const session = JSON.parse(sessionCookie);
      if (session?.isLoggedIn) isLoggedIn = true;
    } catch { isLoggedIn = false; }
  }
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}
```

> [!warning] Validación superficial
> El middleware solo verifica que la cookie exista y contenga `isLoggedIn: true` en el JSON — **no valida la firma ni re-consulta la BD**. Es una validación de forma, no de autenticidad criptográfica. Ver discusión de riesgo en [[Problemas Comunes]].

## Rutas protegidas (`config.matcher`)

```
/dashboard/:path*
/tarifarios/:path*
/comparativo/:path*
/consumo/:path*
/sobrecostos/:path*
/simulador/:path*
/benchmark/:path*
/admin/:path*
```

Nótese que la mayoría de estas rutas **ya están protegidas de antemano** aunque sus páginas todavía no existen (se crearán en fases futuras — ver [[Roadmap]]).

## `src/lib/db.ts` — proxy de base de datos

Aunque no es middleware de Next.js en sentido estricto, `src/lib/db.ts` actúa como una capa intermedia (proxy) entre toda la aplicación y PostgreSQL. Documentado aquí por ser la pieza de infraestructura transversal más crítica del backend.

- **Endpoint remoto**: `https://pg-proxy.onrender.com/query` (mismo proxy que `Proyecto_Dusakawi`).
- **Timeout**: 90 segundos (consultas de agregación/ETL pueden tardar).
- **Reintentos**: hasta 3, con distinción cold-start (< 15s) vs. timeout real de query pesada.
- **Etiquetado**: cada query se etiqueta como `Contratacion_dusakawiepi/<source>` en `pg_stat_activity`.
- Ver diagrama de reintentos en [[Patrones#Proxy HTTP en vez de conexión directa a PostgreSQL]].

```ts
export const pool = {
  query: async (sql, params = [], source) => executeQuery(sql, params, source),
  connect: async () => ({
    query: async (sql, params = [], source) => executeQuery(sql, params, source),
    release: () => {},
  }),
};
```

> [!info] Compatibilidad de interfaz
> `pool.connect()` expone `.query()` y `.release()` para mantener compatibilidad de forma con el patrón `pg.Pool` estándar, aunque internamente no hay conexión TCP directa — todo pasa por HTTP.

## Ejemplo de uso

```ts
const result = await pool.query(
  `SELECT id, username FROM administrativo.negociacion_contratacion_usuario WHERE activo = $1`,
  [1],
  "admin/listar-usuarios"
);
```

## Problemas conocidos
- Timeout de gateway: si el proxy responde 502/503 tras ≥15s, se asume timeout real de una query pesada y **no se reintenta** (para no apilar seq scans). El mensaje de error resultante sugiere reducir el rango de fechas.
- `PROXY_API_KEY` tiene un valor por defecto hardcodeado en el código como fallback de desarrollo — ver [[Problemas Comunes]] y [[Variables]].

## Ver también
- [[Autenticación]]
- [[Controladores]]
- [[Variables]]
