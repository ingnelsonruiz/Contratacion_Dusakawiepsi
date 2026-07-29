import Activity from "lucide-react/icons/activity";

import { ConsumoFrecuenciaClient } from "@/components/consumo-frecuencia/consumo-frecuencia-client";

export const dynamic = "force-dynamic";

export default function ConsumoFrecuenciaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Activity className="h-6 w-6 text-primary" /> Consumo y Frecuencia
        </h1>
        <p className="text-sm text-muted-foreground">
          Consumo real facturado (RIPS) de un prestador, agregado por código, en un mes específico — cantidad de eventos/unidades
          y valor total facturado en Procedimientos (CUPS), Medicamentos (CUM) e Insumos.
        </p>
      </div>

      <ConsumoFrecuenciaClient />
    </div>
  );
}
