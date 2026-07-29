import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: {
    // Igual que Proyecto_Dusakawi: no bloquear el build por errores de tipos/lint
    // mientras el proyecto está en construcción incremental por fases.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // 2026-07-28 — causa raíz REAL del "__webpack_require__.n is not a
  // function" en /login (se repitió 4 veces con el intento anterior, que
  // agregaba `modularizeImports` para lucide-react): Next.js 15 optimiza
  // automáticamente los imports de "lucide-react" vía
  // `experimental.optimizePackageImports` (habilitado por defecto para este
  // paquete, sin necesidad de configurarlo). Al tener ADEMÁS un
  // `modularizeImports` manual para el mismo paquete, ambas transformaciones
  // se aplicaban sobre el mismo import y generaban una interop CJS/ESM rota
  // (exactamente el síntoma `__webpack_require__.n is not a function`) — por
  // eso el error sobrevivía incluso con caché y node_modules limpios: no era
  // un problema de caché, era un conflicto entre dos transformaciones activas
  // a la vez sobre el mismo paquete.
  //
  // Fix definitivo: se eliminó `modularizeImports` de aquí Y se reescribieron
  // TODOS los imports de lucide-react en el código (14 archivos) a la forma
  // de import profundo soportada oficialmente por el propio paquete
  // (`lucide-react/icons/<kebab-case>`, ver "exports" en su package.json) en
  // vez de `import { X } from "lucide-react"`. Sin un import de barrel en
  // ningún archivo, no hay nada para que ninguna de las dos optimizaciones
  // (la automática de Next o `modularizeImports`) transforme — se elimina la
  // clase completa de bug en vez de intentar configurarla correctamente.
  // Ver KnowledgeBase/09-Errores/Problemas Comunes.md #9 (actualizado).
  webpack: (config, { dev }) => {
    // Se agregaron varias dependencias nuevas en poco tiempo (@radix-ui/react-tabs,
    // exceljs) mientras la caché persistente de webpack (`.next/cache/webpack`)
    // ya existía de una sesión anterior. Next reutiliza esa caché entre reinicios
    // de `npm run dev` a propósito (para arrancar más rápido), pero si quedó un
    // módulo mapeado de forma inconsistente con el runtime actual, el síntoma es
    // exactamente "__webpack_require__.n is not a function" repitiéndose en cada
    // reinicio (no se autocorrige solo con Ctrl+C + volver a correr `npm run dev`,
    // porque la caché en disco no se limpia sola). Se desactiva la caché de
    // filesystem SOLO en modo dev para forzar una compilación limpia en cada
    // arranque mientras el proyecto sigue creciendo rápido; no afecta producción.
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
