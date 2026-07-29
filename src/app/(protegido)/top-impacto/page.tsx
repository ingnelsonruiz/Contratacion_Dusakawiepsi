import Trophy from "lucide-react/icons/trophy";

import { TopImpactoClient } from "@/components/top-impacto/top-impacto-client";

export const dynamic = "force-dynamic";

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
