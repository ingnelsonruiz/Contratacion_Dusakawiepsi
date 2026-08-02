import Trophy from "lucide-react/icons/trophy";

import { TopImpactoClient } from "@/components/top-impacto/top-impacto-client";

export const dynamic = "force-dynamic";

// Rediseño 2026-08-02: la consulta principal ya NO se ejecuta dentro de la
// petición HTTP que el navegador espera — `consultar()` crea un job
// (`iniciarAnalisisImpactoJob`, respuesta inmediata) y el cómputo pesado
// corre en segundo plano vía `after()` de Next.js, con el cliente haciendo
// polling del progreso real. Ver top-impacto-actions.ts.
//
// `maxDuration` se conserva (y se amplía) porque en Vercel el trabajo de
// `after()` TAMBIÉN cuenta contra el límite de duración de la función que lo
// programó. ⚠️ CORRECCIÓN 2026-08-02: un intento anterior declaró 800 y el
// despliegue FALLÓ en la fase "Deploying outputs..." — Vercel NO recorta el
// valor al techo del plan, RECHAZA el deploy completo si lo excede. 300 es
// el máximo aceptado en el plan Pro (y en Hobby con Fluid Compute activo).
// Si el deploy aún falla con este valor, el plan solo permite 60s: activar
// Fluid Compute en Settings → Functions o bajar este valor a 60 (con 60s,
// solo los análisis con prestador fijo alcanzan a terminar; los
// EPS-completa necesitarán otro mecanismo de ejecución). En self-hosted
// (`next start`) este export se ignora. Ver KnowledgeBase/08-Deployment/Vercel.md.
export const maxDuration = 300;

export default function TopImpactoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Trophy className="h-6 w-6 text-primary" /> Análisis de Códigos de Mayor Impacto Económico
        </h1>
        <p className="text-sm text-muted-foreground">
          Los 100 procedimientos, consultas, medicamentos e insumos que representan el mayor valor económico radicado
          para la EPS — para saber en qué códigos enfocarse en la próxima negociación.
        </p>
      </div>

      <TopImpactoClient />
    </div>
  );
}
