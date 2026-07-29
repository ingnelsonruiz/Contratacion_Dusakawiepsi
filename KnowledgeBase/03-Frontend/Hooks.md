---
tags: [frontend, hooks, react]
---

# Hooks

## Propósito
Documentar el uso de hooks de React/Next.js en el frontend actual. **No existen hooks personalizados (`useAlgo.ts`) todavía** — solo hooks nativos de React y de Next.js aplicados directamente en los Client Components.

## Hooks nativos en uso

| Hook | Dónde se usa | Para qué |
|---|---|---|
| `useState` | `LoginForm` | Estado local de `username`, `password`, `error` |
| `useTransition` | `LoginForm`, `LogoutButton` | Marcar transiciones asíncronas (`isPending`) sin bloquear la UI, mostrar spinner |
| `useRouter` (next/navigation) | `LoginForm`, `LogoutButton` | Navegación programática (`router.push`, `router.refresh`) tras login/logout |
| `useSearchParams` (next/navigation) | `LoginForm` | Leer `callbackUrl` para redirigir tras login exitoso |

## Ejemplo — patrón `useTransition` + Server Action

```tsx
const [isPending, startTransition] = useTransition();

const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  startTransition(async () => {
    const result = await loginAction(username, password);
    if (result.success) {
      router.push(searchParams.get("callbackUrl") || "/dashboard");
      router.refresh();
    } else {
      setError(result.error || "No fue posible iniciar sesión.");
    }
  });
};
```

Este es el **patrón de referencia** a repetir en los formularios de los módulos futuros (Simulador, Admin, etc.): `useTransition` para no bloquear la UI mientras la Server Action corre, `useState` para el mensaje de error.

## Hooks planificados

Ninguno documentado formalmente todavía. Candidatos naturales cuando se construyan los módulos: un hook `useFiltrosTarifario()` o similar para manejar estado compartido de filtros de fecha/prestador/código entre componentes de un mismo módulo.

## Ver también
- [[Componentes]]
- [[Estados]]
