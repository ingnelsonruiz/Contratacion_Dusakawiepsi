"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Search from "lucide-react/icons/search";
import FileDown from "lucide-react/icons/file-down";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import Printer from "lucide-react/icons/printer";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import type { ParametrosBusquedaTarifario, ResultadoPaginado, TipoTarifario } from "@/types/tarifarios";

export interface ColumnaTabla<T> {
  header: string;
  render: (fila: T) => React.ReactNode;
  className?: string;
}

interface TablaTarifarioProps<T> {
  consecutivoContrato: number;
  tipo: TipoTarifario;
  cargarPagina: (consecutivoContrato: number, params: ParametrosBusquedaTarifario) => Promise<ResultadoPaginado<T>>;
  columnas: ColumnaTabla<T>[];
  claveFila: (fila: T) => string | number;
  placeholderBusqueda: string;
  tituloExport: string;
}

const PAGE_SIZE = 50;

/**
 * Tabla genérica para las 5 pestañas del detalle de contrato (Procedimientos,
 * Medicamentos, Insumos, Paquetes, Otros). Se parametriza por la Server
 * Action de carga y las columnas a mostrar — la lógica de búsqueda,
 * paginación server-side, exportación e impresión vive una sola vez aquí,
 * no se duplica por pestaña (principio de arquitectura: fuente única
 * reutilizable, ver docs/ARQUITECTURA.md).
 *
 * La carga de datos invoca directamente la Server Action (RPC de Next.js),
 * lo que permite cambiar de pestaña/página/búsqueda sin recargar la página
 * completa. La exportación binaria (Excel) pasa por un Route Handler
 * dedicado (`/api/export/tarifario`) en vez de traer ExcelJS al bundle del
 * cliente.
 */
export function TablaTarifario<T>({
  consecutivoContrato,
  tipo,
  cargarPagina,
  columnas,
  claveFila,
  placeholderBusqueda,
  tituloExport,
}: TablaTarifarioProps<T>) {
  const [busquedaInput, setBusquedaInput] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);
  const [resultado, setResultado] = useState<ResultadoPaginado<T>>({
    filas: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPaginas: 1,
  });
  const [, startTransition] = useTransition();
  const [cargando, setCargando] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    cargarPagina(consecutivoContrato, { busqueda, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!cancelado) setResultado(res);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consecutivoContrato, busqueda, page]);

  function handleBusquedaChange(valor: string) {
    setBusquedaInput(valor);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      startTransition(() => setBusqueda(valor));
    }, 350);
  }

  function urlExport(formato: "xlsx" | "csv"): string {
    const params = new URLSearchParams({
      contrato: String(consecutivoContrato),
      tipo,
      formato,
    });
    if (busqueda) params.set("busqueda", busqueda);
    return `/api/export/tarifario?${params.toString()}`;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busquedaInput}
            onChange={(e) => handleBusquedaChange(e.target.value)}
            placeholder={placeholderBusqueda}
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Badge className="mr-1">{resultado.total.toLocaleString("es-CO")} registros</Badge>
          <Button variant="outline" size="sm" asChild>
            <a href={urlExport("xlsx")} download={`${tituloExport}.xlsx`}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={urlExport("csv")} download={`${tituloExport}.csv`}>
              <FileDown className="h-4 w-4" /> CSV
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columnas.map((c) => (
                <TableHead key={c.header} className={c.className}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {resultado.filas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnas.length} className="py-10 text-center text-sm text-muted-foreground">
                  {cargando ? "Cargando…" : "Sin registros para los criterios actuales."}
                </TableCell>
              </TableRow>
            ) : (
              resultado.filas.map((fila) => (
                <TableRow key={claveFila(fila)}>
                  {columnas.map((c) => (
                    <TableCell key={c.header} className={c.className}>
                      {c.render(fila)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Paginacion
        page={resultado.page}
        totalPaginas={resultado.totalPaginas}
        total={resultado.total}
        pageSize={resultado.pageSize}
        onPageChange={setPage}
        cargando={cargando}
      />
    </div>
  );
}
