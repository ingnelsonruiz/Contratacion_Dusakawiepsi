import UploadCloud from "lucide-react/icons/upload-cloud";

import { AnalisisPropuestaClient } from "@/components/analisis-propuesta/analisis-propuesta-client";

export const dynamic = "force-dynamic";

export default function AnalisisPropuestaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <UploadCloud className="h-6 w-6 text-primary" /> Análisis de Propuesta del Prestador
        </h1>
        <p className="text-sm text-muted-foreground">
          Suba el listado de códigos y precios que un prestador está ofertando (CSV, TXT o Excel) y compárelo contra{" "}
          lo que ya se paga en el <strong>mismo municipio</strong> a otros prestadores — mediana, quién más lo presta
          y sus ofertas vigentes más favorables, para negociar con datos reales.
        </p>
      </div>

      <AnalisisPropuestaClient />
    </div>
  );
}
