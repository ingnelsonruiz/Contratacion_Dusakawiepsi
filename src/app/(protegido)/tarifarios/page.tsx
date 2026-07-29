import Link from "next/link";
import { Suspense } from "react";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import ArrowRight from "lucide-react/icons/arrow-right";

import { listContratos, getOpcionesFiltro } from "@/app/actions/tarifario-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { FiltrosContrato } from "@/components/tarifarios/filtros-contrato";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { formatearMoneda, formatearFecha } from "@/lib/negociacion/formato";
import type { FiltrosContrato as FiltrosContratoTipo } from "@/types/tarifarios";

export const dynamic = "force-dynamic"; // siempre datos en vivo de ARYUWIS, sin cache de build

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function leerParam(sp: Awaited<PageProps["searchParams"]>, clave: string): string | undefined {
  const v = sp[clave];
  return Array.isArray(v) ? v[0] : v;
}

export default async function TarifariosPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const filtros: FiltrosContratoTipo = {
    busqueda: leerParam(sp, "busqueda"),
    estado: leerParam(sp, "estado") ? Number(leerParam(sp, "estado")) : undefined,
    tipoContrato: leerParam(sp, "tipoContrato") ? Number(leerParam(sp, "tipoContrato")) : undefined,
    vigencia: (leerParam(sp, "vigencia") as FiltrosContratoTipo["vigencia"]) ?? "todos",
    page: leerParam(sp, "page") ? Number(leerParam(sp, "page")) : 1,
    pageSize: 25,
  };

  const [resultado, opciones] = await Promise.all([listContratos(filtros), getOpcionesFiltro()]);

  // Solo datos serializables (string a string) — Paginacion es un Client
  // Component y arma el href internamente; un Server Component no puede
  // pasarle una función (no serializable por el RSC boundary).
  const queryParamsPaginacion: Record<string, string> = {};
  if (filtros.busqueda) queryParamsPaginacion.busqueda = filtros.busqueda;
  if (filtros.estado !== undefined) queryParamsPaginacion.estado = String(filtros.estado);
  if (filtros.tipoContrato !== undefined) queryParamsPaginacion.tipoContrato = String(filtros.tipoContrato);
  if (filtros.vigencia && filtros.vigencia !== "todos") queryParamsPaginacion.vigencia = filtros.vigencia;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tarifario Vigente e Histórico</h1>
          <p className="text-sm text-muted-foreground">
            Fuente principal de consulta de todos los tarifarios contratados y cargados en ARYUWIS — datos en vivo,
            solo lectura.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Suspense fallback={null}>
            <FiltrosContrato tiposContrato={opciones.tiposContrato} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[16%]">Contrato</TableHead>
                <TableHead className="w-[24%]">Prestador</TableHead>
                <TableHead className="w-[10%]">NIT</TableHead>
                <TableHead className="w-[14%]">Vigencia</TableHead>
                <TableHead className="w-[13%]">Tipo de contratación</TableHead>
                <TableHead className="w-[12%] text-right">Valor contrato</TableHead>
                <TableHead className="w-[9%]">Tarifarios</TableHead>
                <TableHead className="w-[8%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {resultado.filas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    No se encontraron contratos con los filtros aplicados.
                  </TableCell>
                </TableRow>
              ) : (
                resultado.filas.map((c) => (
                  <TableRow key={c.consecutivoContrato}>
                    <TableCell className="font-medium break-words">{c.numeroContrato}</TableCell>
                    <TableCell className="break-words">{c.razonSocial}</TableCell>
                    <TableCell className="break-words">{c.nit}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{formatearFecha(c.fechaInicio)} – {formatearFecha(c.fechaTerminacion)}</span>
                        <Badge variant={c.vigente ? "default" : "outline"} className="mt-1 w-fit text-[10px]">
                          {c.vigente ? "Vigente" : "Vencido"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="break-words">{c.tipoContratoDescripcion ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatearMoneda(c.valorContrato)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.tieneServicios && <Badge variant="outline" className="text-[10px]">Servicios</Badge>}
                        {c.tieneMedicamentos && <Badge variant="outline" className="text-[10px]">Medicamentos</Badge>}
                        {c.tieneInsumos && <Badge variant="outline" className="text-[10px]">Insumos</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/tarifarios/${c.consecutivoContrato}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        Ver <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="px-4">
            <Paginacion
              page={resultado.page}
              totalPaginas={resultado.totalPaginas}
              total={resultado.total}
              pageSize={resultado.pageSize}
              baseHref="/tarifarios"
              queryParams={queryParamsPaginacion}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
