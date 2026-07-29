import History from "lucide-react/icons/history";

import { HistoricoPrestadorClient } from "@/components/historico-prestador/historico-prestador-client";

export const dynamic = "force-dynamic";

export default function HistoricoPrestadorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <History className="h-6 w-6 text-primary" /> Comparativo Histórico del Prestador
        </h1>
        <p className="text-sm text-muted-foreground">
          Evolución de la tarifa negociada con un mismo prestador: compara la foto histórica <strong>2025</strong> contra
          el valor <strong>vigente hoy</strong> en ARYUWIS, por Procedimiento (CUPS), Medicamento (CUM) e Insumo.
        </p>
      </div>

      <HistoricoPrestadorClient />
    </div>
  );
}
