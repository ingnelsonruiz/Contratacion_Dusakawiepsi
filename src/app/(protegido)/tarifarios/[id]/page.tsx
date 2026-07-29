import Link from "next/link";
import { notFound } from "next/navigation";
import ArrowLeft from "lucide-react/icons/arrow-left";
import Building2 from "lucide-react/icons/building-2";

import { getContratoDetalle, getConteosTarifario } from "@/app/actions/tarifario-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TarifarioDetalleClient } from "@/components/tarifarios/tarifario-detalle-client";
import { formatearMoneda, formatearFecha } from "@/lib/negociacion/formato";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TarifarioDetallePage({ params }: PageProps) {
  const { id } = await params;
  const consecutivoContrato = Number(id);

  if (!Number.isFinite(consecutivoContrato)) {
    notFound();
  }

  const contrato = await getContratoDetalle(consecutivoContrato);
  if (!contrato) {
    notFound();
  }

  const conteos = await getConteosTarifario(consecutivoContrato);

  const datosResumen = [
    { etiqueta: "Número de contrato", valor: contrato.numeroContrato },
    { etiqueta: "Prestador", valor: contrato.razonSocial },
    { etiqueta: "NIT", valor: contrato.nit },
    { etiqueta: "Vigencia", valor: `${formatearFecha(contrato.fechaInicio)} – ${formatearFecha(contrato.fechaTerminacion)}` },
    { etiqueta: "Valor contratado", valor: formatearMoneda(contrato.valorContrato) },
    { etiqueta: "Tipo de contratación", valor: contrato.tipoContratoDescripcion ?? "—" },
    { etiqueta: "Responsable del contrato", valor: contrato.nombreResponsableContratacion ?? "—" },
  ];

  return (
    <div className="space-y-6 print:space-y-3">
      <div className="flex items-center gap-2 print:hidden">
        <Link href="/tarifarios" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Volver al listado de contratos
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6 text-primary" />
              <div>
                <h1 className="text-xl font-bold tracking-tight">{contrato.numeroContrato}</h1>
                <p className="text-sm text-muted-foreground">{contrato.razonSocial}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Badge variant={contrato.vigente ? "default" : "outline"}>{contrato.vigente ? "Vigente" : "Vencido"}</Badge>
              <Badge variant="secondary">Estado {contrato.estado}</Badge>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {datosResumen.map((d) => (
              <div key={d.etiqueta}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{d.etiqueta}</dt>
                <dd className="text-sm font-medium">{d.valor}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <TarifarioDetalleClient consecutivoContrato={consecutivoContrato} conteos={conteos} />
    </div>
  );
}
