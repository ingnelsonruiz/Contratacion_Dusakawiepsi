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
// programó — con el presupuesto nuevo del job (hasta 300s por consulta
// pesada, ver OPCIONES_QUERY_JOB en top-impacto-actions.ts), 120s lo mataría
// a mitad de camino. En despliegue self-hosted (`next start`) este export es
// inofensivo/ignorado. El techo real en Vercel depende del plan contratado
// (la plataforma lo recorta sola si el plan no lo permite — declararlo de
// más no rompe nada); ver KnowledgeBase/08-Deployment/Vercel.md.
export const maxDuration = 800;

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
