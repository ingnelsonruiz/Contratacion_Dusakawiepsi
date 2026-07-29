import Scale from "lucide-react/icons/scale";

import { ComparativoClient } from "@/components/comparativo/comparativo-client";

export const dynamic = "force-dynamic";

export default function ComparativoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Scale className="h-6 w-6 text-primary" /> Comparativo entre Prestadores
        </h1>
        <p className="text-sm text-muted-foreground">
          Compara tarifas de un mismo código (CUPS, CUM o Insumo) entre prestadores del{" "}
          <strong>mismo municipio</strong> — así la variabilidad que se ve es la de la negociación real, no la del
          lugar donde se ofertó el contrato.
        </p>
      </div>

      <ComparativoClient />
    </div>
  );
}
