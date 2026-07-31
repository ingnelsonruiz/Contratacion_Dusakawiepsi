import Trophy from "lucide-react/icons/trophy";

import { TopImpactoClient } from "@/components/top-impacto/top-impacto-client";

export const dynamic = "force-dynamic";

// Fix 2026-07-31: la barra de progreso de este módulo quedaba congelada
// (reportado por el usuario: "se quedo aca no avanza", filtros tipo=Todos +
// municipio, sin prestador — el caso más pesado de `getTopImpacto()`, que
// corre 3 consultas de agregación SECUENCIALES sobre RIPS completos). Causa
// más probable, documentada en KnowledgeBase/09-Errores/Problemas Comunes.md
// (#5) y KnowledgeBase/08-Deployment/Vercel.md: `PROXY_TIMEOUT_MS = 90000`
// (src/lib/db.ts) excede el límite de función serverless del plan de Vercel
// (10s en el plan Hobby) — la plataforma mata la función ANTES de que el
// proxy responda o reintente, y el cliente nunca recibe una promesa resuelta
// ni rechazada, dejando la barra simulada congelada en su tope (92%) para
// siempre. `maxDuration` le pide a Vercel más margen para las Server Actions
// invocadas desde esta página; el techo real depende del plan contratado
// (Vercel lo recorta automáticamente si el plan no lo permite — no rompe
// nada declararlo de más). No reemplaza confirmar el plan adecuado en
// producción (ver Vercel.md), solo mitiga el caso más común.
export const maxDuration = 120;

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
