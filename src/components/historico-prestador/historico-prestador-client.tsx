"use client";

import { useEffect, useMemo, useState } from "react";
import Search from "lucide-react/icons/search";
import ChevronDown from "lucide-react/icons/chevron-down";
import ChevronRight from "lucide-react/icons/chevron-right";
import ListFilter from "lucide-react/icons/list-filter";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import FileDown from "lucide-react/icons/file-down";
import ArrowDownUp from "lucide-react/icons/arrow-down-up";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { colorSemaforo, FiltroEstadosSemaforo } from "@/components/comparativo/semaforo-ui";
import { formatearMoneda, formatearPorcentaje } from "@/lib/negociacion/formato";
import { etiquetaNivelSemaforo } from "@/lib/negociacion/comparativo";
import { getOpcionesPrestadoresHistorico, getHistoricoPrestador } from "@/app/actions/historico-prestador-actions";
import type {
  OpcionPrestadorHistorico,
  ResultadoHistoricoPrestador,
  FilaHistoricoCodigo,
  TipoTarifaHistorico,
} from "@/types/historico-prestador";
import type { UmbralesSemaforo, NivelSemaforo } from "@/types/comparativo";
import { UMBRALES_SEMAFORO_DEFECTO } from "@/types/comparativo";

const PAGE_SIZE = 100;

const ETIQUETAS_TIPO: Record<TipoTarifaHistorico, string> = {
  servicios: "Procedimiento (CUPS)",
  medicamentos: "Medicamento (CUM)",
  insumos: "Insumo",
  otros: "Otro",
};

/**
 * Gráfico de línea mínimo, en SVG puro — sin agregar una librería nueva
 * (recharts no se pudo instalar de forma limpia en esta sesión, ver
 * KnowledgeBase/09-Errores). Solo 2 puntos hoy ("2025" → "Vigente") porque
 * no existe todavía una serie histórica real multi-año — ver comentario en
 * src/types/historico-prestador.ts. Diseñado para aceptar más puntos sin
 * cambios si en el futuro se agregan snapshots periódicos reales.
 */
function GraficoPuntos({ puntos, aumento }: { puntos: { etiqueta: string; valor: number }[]; aumento: boolean | null }) {
  if (puntos.length < 2) {
    return <p className="py-4 text-center text-xs text-muted-foreground">Sin suficientes puntos para graficar.</p>;
  }

  const ancho = 260;
  const alto = 90;
  const margenX = 30;
  const margenY = 16;
  const valores = puntos.map((p) => p.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;

  const coords = puntos.map((p, i) => {
    const x = margenX + (i * (ancho - margenX * 2)) / (puntos.length - 1);
    const y = alto - margenY - ((p.valor - min) / rango) * (alto - margenY * 2);
    return { x, y, ...p };
  });

  const colorLinea = aumento === null ? "#64748b" : aumento ? "#dc2626" : "#0284c7";
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-24 w-full max-w-xs">
      <path d={path} fill="none" stroke={colorLinea} strokeWidth={2} />
      {coords.map((c) => (
        <g key={c.etiqueta}>
          <circle cx={c.x} cy={c.y} r={3.5} fill={colorLinea} />
          <text x={c.x} y={alto - 2} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>
            {c.etiqueta}
          </text>
          <text x={c.x} y={c.y - 8} textAnchor="middle" className="fill-foreground" style={{ fontSize: 9 }}>
            {formatearMoneda(c.valor)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * KPI con dos modos: informativo (por defecto) o "segmentador" clicable
 * (cuando recibe `onClick`) — pedido por el usuario 2026-07-29 para poder
 * filtrar la tabla directamente desde las tarjetas de Códigos comparados /
 * nuevos / eliminados, en vez de solo mostrar el número.
 */
function TarjetaKpi({
  etiqueta,
  valor,
  sub,
  tono,
  onClick,
  activo,
}: {
  etiqueta: string;
  valor: string;
  sub?: string;
  tono?: "rojo" | "azul" | "neutro";
  onClick?: () => void;
  activo?: boolean;
}) {
  const colorValor = tono === "rojo" ? "text-red-600" : tono === "azul" ? "text-sky-600" : "text-foreground";
  const esSegmentador = typeof onClick === "function";
  return (
    <Card
      onClick={onClick}
      className={
        esSegmentador
          ? `cursor-pointer transition-colors hover:border-primary ${activo ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`
          : undefined
      }
    >
      <CardContent className="pt-6">
        <p className="text-xs font-medium text-muted-foreground">{etiqueta}</p>
        <p className={`mt-1 text-xl font-bold ${colorValor}`}>{valor}</p>
        {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
        {esSegmentador ? (
          <p className="mt-1 text-[10px] font-medium text-primary">{activo ? "✓ Filtrando esta vista" : "Clic para filtrar la tabla"}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FilaHistoricoExpandible({ fila }: { fila: FilaHistoricoCodigo }) {
  const [abierto, setAbierto] = useState(false);
  const disponibleEnAmbos = fila.valor2025 !== null && fila.valorVigente !== null;

  return (
    <>
      <TableRow
        className={abierto ? "cursor-pointer border-l-4 border-l-primary bg-primary/10 hover:bg-primary/15" : "cursor-pointer hover:bg-muted/50"}
        onClick={() => setAbierto((v) => !v)}
      >
        <TableCell className="w-8">
          {abierto ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-mono text-xs">{fila.codigoTarifa}</TableCell>
        <TableCell className="max-w-[260px] truncate" title={fila.descripcion}>
          {fila.descripcion}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{ETIQUETAS_TIPO[fila.tipo]}</TableCell>
        {/* Valor + contrato apilados en una sola celda — antes eran 2 columnas
            separadas; pedido del usuario 2026-07-29: el desplazamiento
            horizontal de la tabla "pierde el enfoque", se necesita ver todo
            de una vez. Mismo criterio aplicado a Valor vigente y a
            Variación $/% más abajo. */}
        <TableCell className="text-right">
          {fila.valor2025 !== null ? (
            <div>
              <div>{formatearMoneda(fila.valor2025)}</div>
              {fila.contrato2025 ? <div className="font-mono text-[10px] text-muted-foreground">{fila.contrato2025}</div> : null}
            </div>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="text-right">
          {fila.valorVigente !== null ? (
            <div>
              <div>{formatearMoneda(fila.valorVigente)}</div>
              {fila.contratoVigente ? <div className="font-mono text-[10px] text-muted-foreground">{fila.contratoVigente}</div> : null}
            </div>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="text-right">
          {fila.variacionPct !== null ? (
            <div>
              <div className={`font-semibold ${fila.variacionPct > 0 ? "text-red-600" : fila.variacionPct < 0 ? "text-sky-600" : ""}`}>
                {fila.variacionPct > 0 ? "+" : ""}
                {formatearPorcentaje(fila.variacionPct)}
              </div>
              <div
                className={`text-[10px] ${
                  fila.variacionAbsoluta! > 0 ? "text-red-600" : fila.variacionAbsoluta! < 0 ? "text-sky-600" : "text-muted-foreground"
                }`}
              >
                {fila.variacionAbsoluta! > 0 ? "+" : ""}
                {formatearMoneda(fila.variacionAbsoluta!)}
              </div>
            </div>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="text-center">
          {fila.nivel ? (
            <Badge className={colorSemaforo(fila.nivel)}>{etiquetaNivelSemaforo(fila.nivel)}</Badge>
          ) : (
            <Badge variant="outline">{fila.valorVigente === null ? "Solo 2025" : "Nuevo"}</Badge>
          )}
        </TableCell>
      </TableRow>
      {abierto && (
        <TableRow className="border-l-4 border-l-primary bg-primary/5">
          <TableCell colSpan={8} className="p-4">
            {disponibleEnAmbos ? (
              <div className="flex flex-col items-center gap-1 sm:flex-row sm:items-start sm:justify-center">
                <GraficoPuntos puntos={fila.puntos} aumento={fila.variacionAbsoluta !== null ? fila.variacionAbsoluta > 0 : null} />
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {fila.valorVigente === null
                  ? "Este código estaba en la foto 2025 pero ya no está vigente en el tarifario actual (posible código retirado/vencido)."
                  : "Este código está vigente hoy pero no aparecía en la foto 2025 (posible código negociado después)."}
              </p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function HistoricoPrestadorClient() {
  const [prestadores, setPrestadores] = useState<OpcionPrestadorHistorico[]>([]);
  const [cargandoPrestadores, setCargandoPrestadores] = useState(true);
  const [busquedaPrestador, setBusquedaPrestador] = useState("");
  const [nitSeleccionado, setNitSeleccionado] = useState("");

  const [umbrales, setUmbrales] = useState<UmbralesSemaforo>(UMBRALES_SEMAFORO_DEFECTO);
  const [resultado, setResultado] = useState<ResultadoHistoricoPrestador | null>(null);
  const [cargandoResultado, setCargandoResultado] = useState(false);

  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoTarifaHistorico>("todos");
  const [estadosFiltro, setEstadosFiltro] = useState<NivelSemaforo[]>([]);
  const [ordenVariacion, setOrdenVariacion] = useState<"desc" | "asc">("desc");
  // Segmentador de las tarjetas Códigos comparados/nuevos/eliminados — pedido
  // por el usuario 2026-07-29: poder filtrar la tabla haciendo clic en la
  // tarjeta, no solo ver el número.
  const [filtroSegmento, setFiltroSegmento] = useState<"todos" | "comparados" | "nuevos" | "eliminados">("todos");
  // Sub-segmentador dentro de "Códigos comparados" — mismo día, pedido de
  // seguimiento: poder filtrar además por subieron/bajaron/igual (los 3
  // conteos que ya se mostraban como texto plano bajo esa tarjeta).
  const [filtroDireccion, setFiltroDireccion] = useState<"todos" | "subieron" | "bajaron" | "igual">("todos");
  const [pagina, setPagina] = useState(1);

  function alternarSegmento(valor: "comparados" | "nuevos" | "eliminados") {
    setFiltroSegmento((actual) => (actual === valor ? "todos" : valor));
    setFiltroDireccion("todos");
    setPagina(1);
  }

  function alternarDireccion(valor: "subieron" | "bajaron" | "igual") {
    const nuevaDireccion = filtroDireccion === valor ? "todos" : valor;
    setFiltroDireccion(nuevaDireccion);
    // Subieron/bajaron/igual solo existen dentro de "comparados" (los
    // nuevos/eliminados no tienen variación calculable) — al elegir una
    // dirección, la vista queda acotada a comparados automáticamente.
    setFiltroSegmento(nuevaDireccion === "todos" ? "todos" : "comparados");
    setPagina(1);
  }

  useEffect(() => {
    getOpcionesPrestadoresHistorico()
      .then(setPrestadores)
      .finally(() => setCargandoPrestadores(false));
  }, []);

  const prestadoresFiltrados = useMemo(() => {
    const q = busquedaPrestador.trim().toLowerCase();
    if (!q) return prestadores;
    return prestadores.filter((p) => p.razonSocial.toLowerCase().includes(q) || p.nit.includes(q));
  }, [prestadores, busquedaPrestador]);

  async function consultar(nit: string) {
    if (!nit) return;
    setCargandoResultado(true);
    setPagina(1);
    try {
      const res = await getHistoricoPrestador(nit, umbrales);
      setResultado(res);
    } finally {
      setCargandoResultado(false);
    }
  }

  // Recalcula el semáforo con los umbrales actuales sin volver a consultar la
  // BD cuando el usuario ajusta Alerta/Crítico — mismo criterio que Módulo 2.
  useEffect(() => {
    if (nitSeleccionado) consultar(nitSeleccionado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [umbrales]);

  const filasFiltradas = useMemo(() => {
    if (!resultado) return [];
    const filtradas = resultado.filas.filter((f) => {
      if (filtroTipo !== "todos" && f.tipo !== filtroTipo) return false;
      if (estadosFiltro.length > 0) {
        if (!f.nivel || !estadosFiltro.includes(f.nivel)) return false;
      }
      // "Comparado" = tiene valor en 2025 Y en vigente; "nuevo" = solo
      // vigente (sin foto 2025); "eliminado" = solo 2025 (ya no vigente).
      if (filtroSegmento === "comparados" && (f.valor2025 === null || f.valorVigente === null)) return false;
      if (filtroSegmento === "nuevos" && f.valor2025 !== null) return false;
      if (filtroSegmento === "eliminados" && f.valorVigente !== null) return false;
      if (filtroDireccion === "subieron" && !(f.variacionAbsoluta !== null && f.variacionAbsoluta > 0)) return false;
      if (filtroDireccion === "bajaron" && !(f.variacionAbsoluta !== null && f.variacionAbsoluta < 0)) return false;
      if (filtroDireccion === "igual" && !(f.variacionAbsoluta !== null && f.variacionAbsoluta === 0)) return false;
      return true;
    });
    // Ordena por variación % con signo (no por magnitud absoluta) — "mayor a
    // menor" pone primero los mayores AUMENTOS, "menor a mayor" pone primero
    // las mayores DISMINUCIONES. Los códigos "nuevos"/"eliminados" (sin
    // variación calculable) siempre quedan al final, en cualquier dirección.
    const ordenadas = [...filtradas].sort((a, b) => {
      if (a.variacionPct === null && b.variacionPct === null) return 0;
      if (a.variacionPct === null) return 1;
      if (b.variacionPct === null) return -1;
      return ordenVariacion === "desc" ? b.variacionPct - a.variacionPct : a.variacionPct - b.variacionPct;
    });
    return ordenadas;
  }, [resultado, filtroTipo, estadosFiltro, ordenVariacion, filtroSegmento, filtroDireccion]);

  const totalPaginas = Math.max(1, Math.ceil(filasFiltradas.length / PAGE_SIZE));
  const filasPagina = filasFiltradas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  function urlExport(formato: "xlsx" | "csv"): string {
    const params = new URLSearchParams({
      nit: nitSeleccionado,
      alertaPct: String(umbrales.alertaPct),
      criticoPct: String(umbrales.criticoPct),
      formato,
    });
    if (filtroTipo !== "todos") params.set("tipo", filtroTipo);
    if (estadosFiltro.length > 0) params.set("estados", estadosFiltro.join(","));
    if (filtroSegmento !== "todos") params.set("segmento", filtroSegmento);
    if (filtroDireccion !== "todos") params.set("direccion", filtroDireccion);
    return `/api/export/historico-prestador?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busquedaPrestador}
              onChange={(e) => setBusquedaPrestador(e.target.value)}
              placeholder="Buscar por nombre o NIT…"
              className="pl-8"
              disabled={cargandoPrestadores}
            />
          </div>
          <Select
            value={nitSeleccionado}
            onChange={(e) => setNitSeleccionado(e.target.value)}
            className="w-80"
            disabled={cargandoPrestadores || prestadoresFiltrados.length === 0}
          >
            <option value="">
              {cargandoPrestadores ? "Cargando prestadores…" : "Seleccione un prestador…"}
            </option>
            {prestadoresFiltrados.map((p) => (
              <option key={p.nit} value={p.nit}>
                {p.razonSocial} — NIT {p.nit} ({p.cantidadCodigosHistoricos.toLocaleString("es-CO")} códigos en 2025)
              </option>
            ))}
          </Select>
          <Button onClick={() => consultar(nitSeleccionado)} disabled={!nitSeleccionado || cargandoResultado}>
            Consultar
          </Button>
          <p className="text-xs text-muted-foreground sm:ml-auto">
            {prestadores.length.toLocaleString("es-CO")} prestadores con foto histórica 2025 disponible.
          </p>
        </CardContent>
      </Card>

      {resultado && (
        <>
          <Card className="print:hidden">
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end sm:gap-6">
              <div className="flex items-center gap-2">
                <ListFilter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Umbrales del semáforo (2025 → Vigente)</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Alerta desde (%)</label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={umbrales.alertaPct}
                  onChange={(e) => setUmbrales({ ...umbrales, alertaPct: Number(e.target.value) || 0 })}
                  className="w-24"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Crítico desde (%)</label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={umbrales.criticoPct}
                  onChange={(e) => setUmbrales({ ...umbrales, criticoPct: Number(e.target.value) || 0 })}
                  className="w-24"
                />
              </div>
              <p className="max-w-md text-xs text-muted-foreground sm:ml-auto">
                Comparación siempre contra la foto 2025 del propio prestador. Aumento &gt;{umbrales.criticoPct}% ={" "}
                <span className="font-medium text-red-600">Crítico</span>; disminución equivalente ={" "}
                <span className="font-medium text-sky-600">Muy favorable</span>.
              </p>
            </CardContent>
          </Card>

          {/* Tarjetas convertidas en segmentadores clicables — pedido del
              usuario 2026-07-29: se quitó el indicador único de variación
              total (redundante con el desglose subieron/bajaron/igual de
              "Códigos comparados") y ahora las 3 tarjetas filtran la tabla
              de abajo al hacer clic (clic de nuevo = vuelve a "Todos"). */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card
              onClick={() => alternarSegmento("comparados")}
              className={`cursor-pointer transition-colors hover:border-primary ${
                filtroSegmento === "comparados" && filtroDireccion === "todos" ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
              }`}
            >
              <CardContent className="pt-6">
                <p className="text-xs font-medium text-muted-foreground">Códigos comparados</p>
                <p className="mt-1 text-xl font-bold">{resultado.kpis.cantidadCodigosComparados.toLocaleString("es-CO")}</p>
                {/* Sub-segmentadores subieron/bajaron/igual — pedido de
                    seguimiento 2026-07-29. `stopPropagation` para que el clic
                    en un chip no dispare también el onClick de la tarjeta
                    completa (que alternaría el segmento "comparados" entero). */}
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      alternarDireccion("subieron");
                    }}
                    className={`rounded px-1 text-red-600 hover:underline ${filtroDireccion === "subieron" ? "bg-red-100 font-semibold underline" : ""}`}
                  >
                    {resultado.kpis.cantidadAumentaron} subieron
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      alternarDireccion("bajaron");
                    }}
                    className={`rounded px-1 text-sky-600 hover:underline ${filtroDireccion === "bajaron" ? "bg-sky-100 font-semibold underline" : ""}`}
                  >
                    {resultado.kpis.cantidadDisminuyeron} bajaron
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      alternarDireccion("igual");
                    }}
                    className={`rounded px-1 text-muted-foreground hover:underline ${filtroDireccion === "igual" ? "bg-muted font-semibold text-foreground underline" : ""}`}
                  >
                    {resultado.kpis.cantidadSinCambio} igual
                  </button>
                </div>
                <p className="mt-1 text-[10px] font-medium text-primary">
                  {filtroSegmento === "comparados"
                    ? filtroDireccion === "todos"
                      ? "✓ Filtrando esta vista"
                      : `✓ Filtrando: solo ${filtroDireccion}`
                    : "Clic para filtrar la tabla"}
                </p>
              </CardContent>
            </Card>
            <TarjetaKpi
              etiqueta="Códigos nuevos"
              valor={resultado.kpis.cantidadNuevos.toLocaleString("es-CO")}
              sub="Vigentes hoy, sin foto 2025"
              onClick={() => alternarSegmento("nuevos")}
              activo={filtroSegmento === "nuevos"}
            />
            <TarjetaKpi
              etiqueta="Códigos eliminados"
              valor={resultado.kpis.cantidadEliminados.toLocaleString("es-CO")}
              sub="En 2025, ya no vigentes"
              onClick={() => alternarSegmento("eliminados")}
              activo={filtroSegmento === "eliminados"}
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={filtroTipo}
              onChange={(e) => {
                setFiltroTipo(e.target.value as "todos" | TipoTarifaHistorico);
                setPagina(1);
              }}
              className="w-56"
            >
              <option value="todos">Todos los tipos</option>
              <option value="servicios">Procedimientos (CUPS)</option>
              <option value="medicamentos">Medicamentos (CUM)</option>
              <option value="insumos">Insumos</option>
              <option value="otros">Otros</option>
            </Select>
            <div className="flex items-center gap-2">
              <ArrowDownUp className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Select
                value={ordenVariacion}
                onChange={(e) => {
                  setOrdenVariacion(e.target.value as "desc" | "asc");
                  setPagina(1);
                }}
                className="w-60"
              >
                <option value="desc">Variación: mayor a menor</option>
                <option value="asc">Variación: menor a mayor</option>
              </Select>
            </div>
            <FiltroEstadosSemaforo
              seleccionados={estadosFiltro}
              onChange={(v) => {
                setEstadosFiltro(v);
                setPagina(1);
              }}
            />
            <div className="flex items-center gap-2 sm:ml-auto">
              <Badge>{filasFiltradas.length.toLocaleString("es-CO")} códigos</Badge>
              <Button variant="outline" size="sm" asChild>
                <a href={urlExport("xlsx")} download>
                  <FileSpreadsheet className="h-4 w-4" /> Informe Excel
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={urlExport("csv")} download>
                  <FileDown className="h-4 w-4" /> CSV
                </a>
              </Button>
            </div>
          </div>

          <div className="max-h-[65vh] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor 2025 (contrato)</TableHead>
                  <TableHead className="text-right">Valor vigente (contrato)</TableHead>
                  <TableHead className="text-right">Variación (% / $)</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cargandoResultado ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      Cargando…
                    </TableCell>
                  </TableRow>
                ) : filasPagina.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      Sin códigos para los criterios actuales.
                    </TableCell>
                  </TableRow>
                ) : (
                  filasPagina.map((fila) => <FilaHistoricoExpandible key={fila.codigoTarifa} fila={fila} />)
                )}
              </TableBody>
            </Table>
          </div>

          <Paginacion
            page={pagina}
            totalPaginas={totalPaginas}
            total={filasFiltradas.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPagina}
            cargando={cargandoResultado}
          />
        </>
      )}
    </div>
  );
}
