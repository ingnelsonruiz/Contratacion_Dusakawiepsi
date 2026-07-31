import Globe from "lucide-react/icons/globe";

import { PrecioReferenciaEpsClient } from "@/components/precio-referencia-eps/precio-referencia-eps-client";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PrecioReferenciaEpsPage() {
  const session = await getSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Globe className="h-6 w-6 text-primary" /> Precios de Referencia de Otras EPS
        </h1>
        <p className="text-sm text-muted-foreground">
          Alimente esta tabla con los precios que <strong>otras EPS</strong> pagan a prestadores por código, en un
          municipio dado (CSV, TXT o Excel). Se usa como referencia adicional de mercado en{" "}
          <strong>Análisis de Propuesta Prestador</strong>: si un código ofertado ya tiene un precio más económico
          reportado por otra EPS en el mismo municipio, aparece marcado en el acordeón y se incluye en la
          contrapropuesta.
        </p>
      </div>

      <PrecioReferenciaEpsClient rolActual={session?.rol ?? null} />
    </div>
  );
}
