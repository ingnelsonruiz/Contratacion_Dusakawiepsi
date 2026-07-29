---
tags: [errores, soluciones]
---

# Soluciones

Contraparte de [[Problemas Comunes]] — una solución propuesta por cada problema numerado.

## 1. Eliminar el fallback hardcodeado de `PROXY_API_KEY`

```ts
// Antes
const PROXY_API_KEY = process.env.PROXY_API_KEY || "dusakawi-proxy-2024-clave-secreta";

// Después: fallar rápido y explícito si falta la variable
const PROXY_API_KEY = process.env.PROXY_API_KEY;
if (!PROXY_API_KEY) {
  throw new Error("PROXY_API_KEY no está definida. Configúrela en .env.local o en las variables de entorno del hosting.");
}
```
Complementar rotando la clave real si el valor hardcodeado actual ya estuvo expuesto en el repositorio.

## 2. Aplicar la migración pendiente

Seguir [[Flujo Migración]] paso a paso: conectar con credenciales de escritura (no el proxy de solo lectura de análisis), ejecutar `db/migrations/001_negociacion_contratacion_usuario.sql`, verificar con un `SELECT`, y luego correr `npm run seed:admin`.

## 3. Migrar a un hash con sal

Opción de migración gradual sin romper logins existentes:

```ts
// Verificar contra ambos esquemas durante la transición
function verificarPassword(passwordIngresada: string, hashAlmacenado: string): boolean {
  if (hashAlmacenado.length === 64) {
    // Hash legado SHA-256 sin sal
    return sha256Hex(passwordIngresada) === hashAlmacenado;
  }
  // Hash nuevo (ej. bcrypt/argon2)
  return bcrypt.compareSync(passwordIngresada, hashAlmacenado);
}
```
Al hacer login exitoso con el esquema legado, re-hashear con el nuevo algoritmo y actualizar `password_hash` transparentemente.

## 4. Rate limiting de login

Agregar un contador simple por `username` o IP (en memoria para un solo servidor, o en `negociacion_contratacion_usuario`/tabla auxiliar si hay múltiples instancias):

```ts
// Pseudocódigo — no implementado en el repo
const intentos = await obtenerIntentosFallidos(username);
if (intentos >= 5 && dentroDeVentanaDeTiempo(intentos)) {
  return { success: false, error: "Demasiados intentos. Intente de nuevo en unos minutos." };
}
```

## 5. Ajustar timeouts según el plan de hosting

Antes de desplegar en Vercel (ver [[Vercel]]): confirmar el límite de duración de función del plan contratado. Si es menor a 90s, considerar mover las queries de agregación pesada a un Route Handler con `export const maxDuration = <N>` (si el plan lo permite) o a un job separado (cron/worker) en vez de una función invocada por request de usuario.

## 6. Diferenciar errores de tabla inexistente vs. proxy caído

```ts
} catch (error: any) {
  const mensaje = String(error?.message || "");
  if (mensaje.includes("relation") && mensaje.includes("does not exist")) {
    return { success: false, error: "La tabla de usuarios aún no existe. Verifique que la migración 001 haya sido aplicada." };
  }
  return { success: false, error: "No fue posible validar las credenciales (el proxy no está disponible)." };
}
```

## 7. Firmar o validar la cookie de sesión contra el servidor

Opción incremental sin reescribir todo el esquema de sesión: firmar el JSON de sesión con HMAC (usando un secreto de servidor) antes de guardarlo en la cookie, y validar la firma tanto en `middleware.ts` como en `getSession()`. Alternativa más robusta a largo plazo: JWT firmado con `jose` o similar.

## 8. Clasificar Procedimientos por código, no por la FK `consecutivo_cup`

```sql
-- Antes (siempre devuelve 0 filas)
WHERE d.consecutivo_cup IS NOT NULL

-- Después: cruce por código contra el maestro real (tb_cup.codigo_interno tiene índice único)
LEFT JOIN administrativo.tb_cup cup ON cup.codigo_interno = d.codigo_tarifa
WHERE cup.cup IS NOT NULL   -- Procedimiento real
-- y su contraparte para "Otros":
WHERE cup.cup IS NULL AND d.consecutivo_paquete IS NULL
```

Implementado en `getTarifarioServicios`/`getTarifarioOtros`/`getConteosTarifario` de `src/app/actions/tarifario-actions.ts`. Ver el hallazgo completo en [[Tablas]] y [[Contratación#Clasificación de Procedimientos vs. Otros]].

**El mismo fix se aplicó a Medicamentos e Insumos** (`getTarifarioMedicamentos`, `getTarifarioInsumos`) tras detectar que `consecutivo_medicamento`/`consecutivo_insumo` tampoco son confiables (ver [[Problemas Comunes#8b. consecutivo_medicamento/consecutivo_insumo tampoco confiables]]):

```sql
-- Medicamentos: antes
LEFT JOIN administrativo.tb_medicamento med ON med.medicamento = d.consecutivo_medicamento
-- Medicamentos: después
LEFT JOIN administrativo.tb_medicamento med ON med.codigo_interno = d.codigo_tarifa

-- Insumos: antes
LEFT JOIN administrativo.tb_insumo ins ON ins.insumo = d.consecutivo_insumo
-- Insumos: después
LEFT JOIN administrativo.tb_insumo ins ON ins.codigo_interno = d.codigo_tarifa
```

## 9. Eliminar el barrel import de lucide-react — imports profundos oficiales, sin `modularizeImports`

> [!danger] El intento anterior (agregar `modularizeImports`, ver historial de esta misma sección) NO funcionó — el error volvió a aparecer 3 veces más después de aplicarlo. La causa era que `modularizeImports` convivía con la optimización automática de Next 15 (`experimental.optimizePackageImports`, activa por defecto para `lucide-react`) y ambas se aplicaban a la vez sobre el mismo import, rompiendo la interop CJS/ESM. La solución real es no depender de NINGUNA de las dos transformaciones automáticas.

**Paso 1** — quitar `modularizeImports` de `next.config.ts` (ya no hace falta):

```ts
// next.config.ts — sin modularizeImports
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  webpack: (config, { dev }) => {
    if (dev) config.cache = false;
    return config;
  },
};
```

**Paso 2** — reemplazar TODO import de barrel de `lucide-react` por el import profundo oficial del propio paquete (subpath soportado en su `package.json` → `"exports"` → `"./icons/*"`), en los 14 archivos del proyecto que usaban íconos:

```ts
// Antes (barrel import — dispara la optimización automática de Next)
import { AlertCircle, Loader2, LogIn } from "lucide-react";

// Después (import profundo — no hay barrel que optimizar, ninguna transformación aplica)
import AlertCircle from "lucide-react/icons/alert-circle";
import Loader2 from "lucide-react/icons/loader-2";
import LogIn from "lucide-react/icons/log-in";
```

Conversión de nombre: insertar guion antes de cada mayúscula (excepto la primera) y antes de cada dígito, todo en minúsculas (`ChevronDown` → `chevron-down`, `Loader2` → `loader-2`, `Building2` → `building-2`). Se automatizó con un script Python que localiza el bloque `import { ... } from "lucide-react"` (multilínea incluida) en cada archivo y lo reescribe — más seguro que editar cada archivo a mano dado el volumen (14 archivos).

**Paso 3** — como `lucide-react@0.475.0` declara tipos para `./icons/*` en su `package.json` pero esos archivos `.d.ts` no existen realmente en el paquete instalado (bug de empaquetado, verificado), se agregó una declaración ambiental propia para no perder el tipado: `src/types/lucide-react-icons.d.ts` con `declare module "lucide-react/icons/*"`.

**Por qué esta vez es definitivo**: sin ningún `import { X } from "lucide-react"` en el código, no queda ningún barrel import para que la optimización automática de Next (ni `modularizeImports`, que de todos modos se quitó) transforme. Se elimina la clase completa de bug en vez de intentar configurarla correctamente por tercera vez.

## 10. Desactivar la caché de webpack en modo dev

```ts
// next.config.ts
webpack: (config, { dev }) => {
  if (dev) {
    config.cache = false; // fuerza compilación limpia en cada arranque de npm run dev
  }
  return config;
},
```

Trade-off aceptado: arranques de `npm run dev` un poco más lentos a cambio de no arrastrar una caché en disco potencialmente inconsistente mientras el proyecto sigue agregando dependencias rápido. Si el proyecto se estabiliza, se puede remover este workaround y volver a confiar en la caché por defecto.

## 11. Mover constantes compartidas fuera de los archivos "use server"

```ts
// Antes — src/app/actions/tarifario-actions.ts ("use server")
export const CONTRATOS_EXCLUIDOS_MIGRACION = ["0-KS-0", "1-KS-20001"]; // ❌ rompe el build

// Después — src/lib/negociacion/constantes.ts (SIN "use server")
export const CONTRATOS_EXCLUIDOS_MIGRACION = ["0-KS-0", "1-KS-20001"]; // ✅

// tarifario-actions.ts y comparativo-actions.ts (ambos "use server")
import { CONTRATOS_EXCLUIDOS_MIGRACION } from "@/lib/negociacion/constantes";
```

Regla general para el resto del proyecto: cualquier valor (constante, config, mapa de opciones) que necesite compartirse entre Server Actions va en `src/lib/` (sin la directiva), nunca exportado directamente desde un archivo `"use server"`. Las Server Actions de ese archivo lo importan como cualquier otro módulo.

## Ver también
- [[Problemas Comunes]]
- [[Buenas Prácticas]]
- [[Tablas]]
- [[Contratación]]
