"use client";

import { useEffect, useMemo, useState } from "react";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import FileDown from "lucide-react/icons/file-down";
import ArrowDownUp from "lucide-react/icons/arrow-down-up";
import Trophy from "lucide-react/icons/trophy";
import Coins from "lucide-react/icons/coins";
import ListChecks from "lucide-react/icons/list-checks";
import Hash from "lucide-react/icons/hash";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { formatearMoneda, formatearPorcentaje } from "@/lib/negociacion/formato";
import { ETIQUETAS_TIPO_IMPACTO } from "@/lib/negociacion/top-impacto";
import { getOpcionesFiltrosImpacto, getTopImpacto } from "@/app/actions/top-impacto-actions";
import type {
  TipoImpacto,
  OpcionesFiltrosImpacto,
  ResultadoTopImpacto,
  FilaTopImpacto,
  FilaImpactoPrestador,
  FilaImpactoMunicipio,
} from "@/types/top-impacto";

const PAGE_SIZE = 25;

const ETIQUETAS_TIPO_CORTA: Record<Exclude<TipoImpacto, "todos">, string> = {
  servicios: "Servicio",
  consultas: "Consulta",
  medicamentos: "Medicamento",
  insumos: "Insumo",
};

const MENSAJES_CARGA = [
  "Filtrando facturas del período seleccionado…",
  "Agregando procedimientos, medicamentos e insumos…",
  "Calculando el ranking por valor radicado…",
  "Armando los gráficos de mayor impacto…",
];

/** Barra de progreso simulada — mismo patrón ya usado en Dashboard de Riesgo y Perfil del Prestador (consultas pesadas EPS-completa, para que el usuario no sienta que la pantalla está trabada). */
function BarraProgresoCarga({ progreso, mensaje }: { progreso: number; mensaje: string }) {
  return (
    <div className="space-y-2 py-6">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${progreso}%` }} />
      </div>
      <p className="text-center text-xs text-muted-foreground">{mensaje} ({Math.round(progreso)}%)</p>
    </div>
  );
}

function TarjetaKpi({ etiqueta, valor, sub, icono: Icono }: { etiqueta: string; valor: string; sub?: string; icono: any }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icono className="h-3.5 w-3.5" /> {etiqueta}
        </p>
        <p className="mt-1 text-xl font-bold">{valor}</p>
        {sub ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={sub}>
            {sub}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Gráfico de barras horizontal en HTML/CSS puro (divs con ancho %) — sin
 * agregar `recharts` como dependencia nueva (no se pudo instalar de forma
 * limpia en este sandbox, ver KnowledgeBase/09-Errores §12; el resto del
 * proyecto ya resuelve gráficos simples con SVG/HTML propio en vez de
 * reintentarlo).
 */
function GraficoBarras({ titulo, datos }: { titulo: string; datos: { etiqueta: string; valor: number }[] }) {
  const maximo = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="mb-3 text-sm font-semibold">{titulo}</p>
        {datos.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Sin datos para este filtro.</p>
        ) : (
          <div className="space-y-2">
            {datos.map((d, i) => (
              <div key={`${d.etiqueta}-${i}`} className="text-xs">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-muted-foreground" title={d.etiqueta}>
                    {i + 1}. {d.etiqueta}
                  </span>
                  <span className="shrink-0 font-medium">{formatearMoneda(d.valor)}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, (d.valor / maximo) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type ColumnaOrden = "valorTotal" | "cantidad" | "valorPromedio" | "prestadores" | "pctDelTotal";

export function TopImpactoClient() {
  const [opciones, setOpciones] = useState<OpcionesFiltrosImpacto | null>(null);
  const [cargandoOpciones, setCargandoOpciones] = useState(true);

  const [tipo, setTipo] = useState<TipoImpacto>("todos");
  const [anio, setAnio] = useState<number>(new Date().getFullYear());
  const [ipsSeleccionado, setIpsSeleccionado] = useState<string>("");
  const [municipioCodigo, setMunicipioCodigo] = useState<string>("");
  const [numeroContrato, setNumeroContrato] = useState<string>("");

  const [resultado, setResultado] = useState<ResultadoTopImpacto | null>(null);
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [mensajeIdx, setMensajeIdx] = useState(0);

  const [pagina, setPagina] = useState(1);
  const [orden, setOrden] = useState<ColumnaOrden>("valorTotal");
  const [ordenAsc, setOrdenAsc] = useState(false);

  useEffect(() => {
    getOpcionesFiltrosImpacto()
      .then((op) => {
        setOpciones(op);
        setAnio((actual) => (op.anios.includes(actual) ? actual : op.anios[0] ?? actual));
      })
      .finally(() => setCargandoOpciones(false));
  }, []);

  useEffect(() => {
    if (!cargando) return;
    const intervalo = setInterval(() => {
      setProgreso((actual) => {
        if (actual >= 92) return actual;
        const incremento = Math.max(0.3, (92 - actual) * 0.04);
        return Math.min(92, actual + incremento);
      });
    }, 250);
    return () => clearInterval(intervalo);
  }, [cargando]);

  useEffect(() => {
    if (!cargando) {
      setMensajeIdx(0);
      return;
    }
    const intervalo = setInterval(() => setMensajeIdx((i) => (i + 1) % MENSAJES_CARGA.length), 2400);
    return () => clearInterval(intervalo);
  }, [cargando]);

  async function consultar() {
    setCargando(true);
    setProgreso(0);
    setPagina(1);
    try {
      const res = await getTopImpacto({
        tipo,
        anio,
        ips: ipsSeleccionado ? Number(ipsSeleccionado) : null,
        municipioCodigo: municipioCodigo || null,
        numeroContrato: numeroContrato || null,
      });
      setResultado(res);
    } finally {
      setProgreso(100);
      setCargando(false);
    }
  }

  function alternarOrden(columna: ColumnaOrden) {
    if (orden === columna) {
      setOrdenAsc((a) => !a);
    } else {
      setOrden(columna);
      setOrdenAsc(false);
    }
    setPagina(1);
  }

  const filasOrdenadas = useMemo<FilaTopImpacto[]>(() => {
    if (!resultado) return [];
    const copia = [...resultado.top100];
    copia.sort((a, b) => (ordenAsc ? a[orden] - b[orden] : b[orden] - a[orden]));
    return copia;
  }, [resultado, orden, ordenAsc]);

  const totalPaginas = Math.max(1, Math.ceil(filasOrdenadas.length / PAGE_SIZE));
  const filasPagina = filasOrdenadas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  function urlExport(formato: "xlsx" | "csv"): string {
    const params = new URLSearchParams({ tipo, anio: String(anio), formato });
    if (ipsSeleccionado) params.set("ips", ipsSeleccionado);
    if (municipioCodigo) params.set("municipioCodigo", municipioCodigo);
    if (numeroContrato) params.set("numeroContrato", numeroContrato);
    return `/api/export/top-impacto?${params.toString()}`;
  }

  const kpis = resultado?.kpis ?? null;

  const datosGraficoCodigos = (resultado?.top20Codigos ?? []).map((f) => ({
    etiqueta: `${f.codigo} — ${f.descripcion}`,
    valor: f.valorTotal,
  }));
  const datosGraficoPrestadores = (resultado?.top20Prestadores ?? []).map((f: FilaImpactoPrestador) => ({
    etiqueta: f.razonSocial,
    valor: f.valorTotal,
  }));
  const datosGraficoMunicipios = (resultado?.top20Municipios ?? []).map((f: FilaImpactoMunicipio) => ({
    etiqueta: f.municipioNombre,
    valor: f.valorTotal,
  }));

  function EncabezadoOrdenable({ columna, etiqueta, className }: { columna: ColumnaOrden; etiqueta: string; className?: string }) {
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => alternarOrden(columna)}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          {etiqueta}
          <ArrowDownUp className={`h-3 w-3 ${orden === columna ? "text-primary" : "text-muted-foreground/50"}`} />
        </button>
      </TableHead>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:flex-wrap sm:items-center">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoImpacto)} className="w-64">
            {(Object.keys(ETIQUETAS_TIPO_IMPACTO) as TipoImpacto[]).map((t) => (
              <option key={t} value={t}>
                {ETIQUETAS_TIPO_IMPACTO[t]}
              </option>
            ))}
          </Select>
          <Select value={String(anio)} onChange={(e) => setAnio(Number(e.target.value))} className="w-28" disabled={cargandoOpciones}>
            {(opciones?.anios ?? [anio]).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <Select
            value={ipsSeleccionado}
            onChange={(e) => setIpsSeleccionado(e.target.value)}
            className="w-64"
            disabled={cargandoOpciones}
          >
            <option value="">Todos los prestadores</option>
            {(opciones?.prestadores ?? []).map((p) => (
              <option key={p.ips} value={p.ips}>
                {p.razonSocial} — NIT {p.nit}
              </option>
            ))}
          </Select>
          <Select
            value={municipioCodigo}
            onChange={(e) => setMunicipioCodigo(e.target.value)}
            className="w-56"
            disabled={cargandoOpciones}
          >
            <option value="">Todos los municipios</option>
            {(opciones?.municipios ?? []).map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.nombre}
              </option>
            ))}
          </Select>
          <Select
            value={numeroContrato}
            onChange={(e) => setNumeroContrato(e.target.value)}
            className="w-56"
            disabled={cargandoOpciones}
          >
            <option value="">Todos los contratos</option>
            {(opciones?.contratos ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Button onClick={consultar} disabled={cargando || cargandoOpciones}>
            Consultar
          </Button>
        </CardContent>
      </Card>

      {cargando ? (
        <Card>
          <CardContent className="pt-6">
            <BarraProgresoCarga progreso={progreso} mensaje={MENSAJES_CARGA[mensajeIdx]} />
          </CardContent>
        </Card>
      ) : null}

      {!cargando && kpis ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TarjetaKpi etiqueta="Valor total radicado" valor={formatearMoneda(kpis.valorTotalRadicado)} icono={Coins} />
            <TarjetaKpi
              etiqueta="Total de registros radicados"
              valor={kpis.totalRegistros.toLocaleString("es-CO")}
              icono={ListChecks}
            />
            <TarjetaKpi etiqueta="Total de códigos diferentes" valor={kpis.totalCodigosDiferentes.toLocaleString("es-CO")} icono={Hash} />
            <TarjetaKpi
              etiqueta="Código con mayor impacto"
              valor={kpis.codigoMayorImpacto?.codigo ?? "—"}
              sub={kpis.codigoMayorImpacto ? `${kpis.codigoMayorImpacto.descripcion} · ${formatearMoneda(kpis.codigoMayorImpacto.valorTotal)}` : undefined}
              icono={Trophy}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <GraficoBarras titulo="Top 20 códigos de mayor impacto económico" datos={datosGraficoCodigos} />
            <GraficoBarras titulo="Top 20 prestadores por valor radicado" datos={datosGraficoPrestadores} />
            <GraficoBarras titulo="Top 20 municipios por valor radicado" datos={datosGraficoMunicipios} />
          </div>

          <Card>
            <CardContent className="pt-6">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Ranking Top 100 — {resultado?.top100.length ?? 0} códigos</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={urlExport("xlsx")}>
                      <FileSpreadsheet className="h-4 w-4" /> Excel
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={urlExport("csv")}>
                      <FileDown className="h-4 w-4" /> CSV
                    </a>
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead className="min-w-[260px]">Descripción</TableHead>
                      <EncabezadoOrdenable columna="cantidad" etiqueta="Cantidad" className="text-right" />
                      <EncabezadoOrdenable columna="valorTotal" etiqueta="Valor total" className="text-right" />
                      <EncabezadoOrdenable columna="valorPromedio" etiqueta="Valor promedio" className="text-right" />
                      <EncabezadoOrdenable columna="prestadores" etiqueta="Prestadores" className="text-right" />
                      <EncabezadoOrdenable columna="pctDelTotal" etiqueta="% del total" className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filasPagina.map((f, i) => (
                      <TableRow key={`${f.tipo}-${f.codigo}`}>
                        <TableCell className="text-muted-foreground">{(pagina - 1) * PAGE_SIZE + i + 1}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{ETIQUETAS_TIPO_CORTA[f.tipo]}</Badge>
                        </TableCell>
                        <TableCell className="font-mono">{f.codigo}</TableCell>
                        <TableCell className="whitespace-normal break-words">{f.descripcion}</TableCell>
                        <TableCell className="text-right">{f.cantidad.toLocaleString("es-CO")}</TableCell>
                        <TableCell className="text-right font-semibold">{formatearMoneda(f.valorTotal)}</TableCell>
                        <TableCell className="text-right">{formatearMoneda(f.valorPromedio)}</TableCell>
                        <TableCell className="text-right">{f.prestadores.toLocaleString("es-CO")}</TableCell>
                        <TableCell className="text-right">{formatearPorcentaje(f.pctDelTotal, 1)}</TableCell>
                      </TableRow>
                    ))}
                    {filasPagina.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                          Sin resultados para los filtros seleccionados.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>

              <Paginacion
                page={pagina}
                totalPaginas={totalPaginas}
                total={filasOrdenadas.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPagina}
              />
            </CardContent>
          </Card>
        </>
      ) : null}

      {!cargando && !kpis ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Seleccione los filtros y presione <strong className="mx-1">Consultar</strong> para calcular el ranking.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
