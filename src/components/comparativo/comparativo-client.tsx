"use client";

import { useEffect, useMemo, useState } from "react";
import ChevronDown from "lucide-react/icons/chevron-down";
import ChevronRight from "lucide-react/icons/chevron-right";
import Search from "lucide-react/icons/search";
import MapPin from "lucide-react/icons/map-pin";
import ListFilter from "lucide-react/icons/list-filter";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import FileDown from "lucide-react/icons/file-down";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { formatearMoneda, formatearPorcentaje } from "@/lib/negociacion/formato";
import { clasificarSemaforo, etiquetaNivelSemaforo } from "@/lib/negociacion/comparativo";
import { colorSemaforo, ESTADOS_SEMAFORO, FiltroEstadosSemaforo } from "@/components/comparativo/semaforo-ui";
import {
  getOpcionesMunicipios,
  getComparativoPorMunicipio,
  getComparativoPorCodigo,
} from "@/app/actions/comparativo-actions";
import type {
  TipoComparativo,
  OpcionMunicipio,
  FilaComparativoCodigo,
  UmbralesSemaforo,
  ReferenciaVariacion,
  NivelSemaforo,
} from "@/types/comparativo";
import { UMBRALES_SEMAFORO_DEFECTO } from "@/types/comparativo";

const OPCIONES_TIPO: { valor: TipoComparativo; etiqueta: string }[] = [
  { valor: "servicios", etiqueta: "Procedimientos (CUPS)" },
  { valor: "medicamentos", etiqueta: "Medicamentos (CUM)" },
  { valor: "insumos", etiqueta: "Insumos" },
];

const PAGE_SIZE = 20;

// Etiqueta única de negocio (misma que usan las exportaciones Excel/CSV) —
// ver etiquetaNivelSemaforo() en src/lib/negociacion/comparativo.ts.
const etiquetaSemaforo = etiquetaNivelSemaforo;

/** Panel de umbrales + referencia configurables del semáforo — nunca hardcodeado en la UI (ver KnowledgeBase/05-ReglasNegocio/Contratación.md). */
function PanelUmbrales({
  umbrales,
  onChange,
  referencia,
  onChangeReferencia,
}: {
  umbrales: UmbralesSemaforo;
  onChange: (u: UmbralesSemaforo) => void;
  referencia: ReferenciaVariacion;
  onChangeReferencia: (r: ReferenciaVariacion) => void;
}) {
  return (
    <Card className="print:hidden">
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end sm:gap-6">
        <div className="flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Umbrales del semáforo</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Comparar contra</label>
          <Select value={referencia} onChange={(e) => onChangeReferencia(e.target.value as ReferenciaVariacion)} className="w-36">
            <option value="promedio">Promedio</option>
            <option value="mediana">Mediana</option>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Alerta desde (%)</label>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={umbrales.alertaPct}
            onChange={(e) => onChange({ ...umbrales, alertaPct: Number(e.target.value) || 0 })}
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
            onChange={(e) => onChange({ ...umbrales, criticoPct: Number(e.target.value) || 0 })}
            className="w-24"
          />
        </div>
        <p className="max-w-md text-xs text-muted-foreground sm:ml-auto">
          Variación respecto a{referencia === "promedio" ? "l promedio" : " la mediana"} del municipio: dentro de ±{umbrales.alertaPct}% = OK.
          Más caro que la referencia → <span className="font-medium text-amber-600">Alerta</span> (
          {umbrales.alertaPct}–{umbrales.criticoPct}%) / <span className="font-medium text-red-600">Crítico</span> (&gt;{umbrales.criticoPct}%).
          Más barato → <span className="font-medium text-sky-600">Favorable</span> / <span className="font-medium text-sky-700">Muy favorable</span> (mismos
          rangos, no es un riesgo).
        </p>
      </CardContent>
    </Card>
  );
}

function FilaExpandible({
  fila,
  umbrales,
  referencia,
}: {
  fila: FilaComparativoCodigo;
  umbrales: UmbralesSemaforo;
  referencia: ReferenciaVariacion;
}) {
  const [abierto, setAbierto] = useState(false);
  const valorReferencia = referencia === "promedio" ? fila.promedio : fila.mediana;

  return (
    <>
      {/* Fila resaltada mientras está desplegada — pedido por el usuario
          2026-07-28: sin esto, al bajar por una lista larga se perdía de
          vista cuál código correspondía al detalle abierto debajo. */}
      <TableRow
        className={
          abierto
            ? "cursor-pointer border-l-4 border-l-primary bg-primary/10 hover:bg-primary/15"
            : "cursor-pointer hover:bg-muted/50"
        }
        onClick={() => setAbierto((v) => !v)}
      >
        <TableCell className="w-8">
          {abierto ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-mono text-xs">{fila.codigoTarifa}</TableCell>
        <TableCell className="max-w-[320px] truncate" title={fila.descripcion}>
          {fila.descripcion}
        </TableCell>
        {fila.municipioNombre ? (
          <TableCell className="whitespace-nowrap text-sm">
            {fila.municipioNombre} <span className="text-muted-foreground">/ {fila.departamentoNombre}</span>
          </TableCell>
        ) : null}
        <TableCell className="text-center">{fila.cantidadPrestadores}</TableCell>
        <TableCell className="text-right">{formatearMoneda(fila.minimo)}</TableCell>
        <TableCell className="text-right">{formatearMoneda(fila.maximo)}</TableCell>
        <TableCell className="text-right">{formatearMoneda(valorReferencia)}</TableCell>
        <TableCell className="text-right font-semibold">{formatearPorcentaje(fila.amplitudPct)}</TableCell>
      </TableRow>
      {abierto && (
        <TableRow className="border-l-4 border-l-primary bg-primary/5">
          <TableCell colSpan={fila.municipioNombre ? 9 : 8} className="p-0">
            {/* Recuerda a qué código pertenece este detalle sin tener que
                mirar hacia arriba — el encabezado exterior puede haber
                salido de la pantalla al hacer scroll. */}
            <div className="flex items-center gap-2 border-b bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
              <span className="font-mono">{fila.codigoTarifa}</span>
              <span className="truncate text-primary/80">{fila.descripcion}</span>
            </div>
            <div className="p-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prestador</TableHead>
                    <TableHead>NIT</TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">
                      Variación vs. {referencia === "promedio" ? "promedio" : "mediana"} ({formatearMoneda(valorReferencia)})
                    </TableHead>
                    <TableHead className="text-center">Semáforo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fila.prestadores.map((p) => {
                    const variacion = referencia === "promedio" ? p.variacionPctPromedio : p.variacionPctMediana;
                    const nivel = clasificarSemaforo(variacion, umbrales);
                    return (
                      <TableRow key={`${p.ips}-${p.consecutivoContrato}`}>
                        <TableCell>{p.razonSocial}</TableCell>
                        <TableCell className="font-mono text-xs">{p.nit}</TableCell>
                        <TableCell className="font-mono text-xs">{p.numeroContrato}</TableCell>
                        <TableCell className="text-right">{formatearMoneda(p.valorFinal)}</TableCell>
                        <TableCell className="text-right">
                          {variacion > 0 ? "+" : ""}
                          {formatearPorcentaje(variacion)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={colorSemaforo(nivel)}>{etiquetaSemaforo(nivel)}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function ComparativoClient() {
  const [tipo, setTipo] = useState<TipoComparativo>("servicios");
  const [umbrales, setUmbrales] = useState<UmbralesSemaforo>(UMBRALES_SEMAFORO_DEFECTO);
  const [referencia, setReferencia] = useState<ReferenciaVariacion>("promedio");
  const [estadosFiltro, setEstadosFiltro] = useState<NivelSemaforo[]>([]);
  const [municipios, setMunicipios] = useState<OpcionMunicipio[]>([]);
  const [cargandoMunicipios, setCargandoMunicipios] = useState(true);

  // --- Tab "Por municipio" ---
  const [municipioSeleccionado, setMunicipioSeleccionado] = useState<string>("");
  const [busquedaMunicipio, setBusquedaMunicipio] = useState("");
  const [pagina, setPagina] = useState(1);
  const [resultadoMunicipio, setResultadoMunicipio] = useState<{
    filas: FilaComparativoCodigo[];
    total: number;
    page: number;
    totalPaginas: number;
  }>({ filas: [], total: 0, page: 1, totalPaginas: 1 });
  const [cargandoTabla, setCargandoTabla] = useState(false);

  // --- Tab "Buscar código" ---
  const [codigoBusqueda, setCodigoBusqueda] = useState("");
  const [municipioBusqueda, setMunicipioBusqueda] = useState<string>("");
  const [resultadoBusqueda, setResultadoBusqueda] = useState<FilaComparativoCodigo[] | null>(null);
  const [cargandoBusqueda, setCargandoBusqueda] = useState(false);

  // Cargar municipios disponibles cada vez que cambia el tipo de tarifario.
  useEffect(() => {
    let cancelado = false;
    setCargandoMunicipios(true);
    getOpcionesMunicipios(tipo)
      .then((data) => {
        if (cancelado) return;
        setMunicipios(data);
        setMunicipioSeleccionado((actual) => (data.some((m) => m.municipioCodigo === actual) ? actual : data[0]?.municipioCodigo ?? ""));
        setMunicipioBusqueda("");
        setResultadoBusqueda(null);
      })
      .finally(() => {
        if (!cancelado) setCargandoMunicipios(false);
      });
    return () => {
      cancelado = true;
    };
  }, [tipo]);

  // Cargar la tabla comparativa cuando cambia municipio/búsqueda/página/tipo.
  useEffect(() => {
    if (!municipioSeleccionado) {
      setResultadoMunicipio({ filas: [], total: 0, page: 1, totalPaginas: 1 });
      return;
    }
    let cancelado = false;
    setCargandoTabla(true);
    getComparativoPorMunicipio(municipioSeleccionado, tipo, {
      busqueda: busquedaMunicipio,
      page: pagina,
      pageSize: PAGE_SIZE,
      umbrales,
      referencia,
      estadosFiltro,
    })
      .then((res) => {
        if (!cancelado) setResultadoMunicipio(res);
      })
      .finally(() => {
        if (!cancelado) setCargandoTabla(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipioSeleccionado, tipo, busquedaMunicipio, pagina, umbrales, referencia, estadosFiltro]);

  // Construye la URL del Route Handler de exportación (/api/export/comparativo)
  // con EXACTAMENTE los mismos filtros/umbrales/referencia que la vista actual
  // — pedido del usuario 2026-07-28: "un Excel con los datos de todo un
  // informe completo para análisis por parte de un analista de contratación".
  // No pagina (el Route Handler trae TODO el resultado filtrado), a
  // diferencia de la tabla en pantalla.
  function urlExportComparativo(modo: "municipio" | "codigo", formato: "xlsx" | "csv"): string {
    const params = new URLSearchParams({
      modo,
      tipo,
      referencia,
      alertaPct: String(umbrales.alertaPct),
      criticoPct: String(umbrales.criticoPct),
      formato,
    });
    if (estadosFiltro.length > 0) params.set("estados", estadosFiltro.join(","));
    if (modo === "municipio") {
      if (municipioSeleccionado) params.set("municipio", municipioSeleccionado);
      if (busquedaMunicipio) params.set("busqueda", busquedaMunicipio);
    } else {
      if (codigoBusqueda) params.set("busqueda", codigoBusqueda);
      if (municipioBusqueda) params.set("municipio", municipioBusqueda);
    }
    return `/api/export/comparativo?${params.toString()}`;
  }

  const departamentos = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const m of municipios) mapa.set(m.departamentoCodigo, m.departamentoNombre);
    return Array.from(mapa.entries()).map(([codigo, nombre]) => ({ codigo, nombre }));
  }, [municipios]);

  async function buscarPorCodigo() {
    if (!codigoBusqueda.trim()) return;
    setCargandoBusqueda(true);
    try {
      const res = await getComparativoPorCodigo(codigoBusqueda, tipo, municipioBusqueda || undefined);
      setResultadoBusqueda(res);
    } finally {
      setCargandoBusqueda(false);
    }
  }

  // La pestaña "Buscar código" ya trae TODO el resultado (sin paginar) —
  // el filtro por estado se aplica en cliente, sin volver a llamar al Server Action.
  // Igual que en getComparativoPorMunicipio: no basta con filtrar qué códigos
  // se muestran, también hay que recortar la lista de prestadores de cada
  // código a solo los que están en el estado elegido (si no, al desplegar
  // seguían saliendo prestadores de otros estados no seleccionados).
  const resultadoBusquedaFiltrado = useMemo(() => {
    if (!resultadoBusqueda) return resultadoBusqueda;
    if (estadosFiltro.length === 0) return resultadoBusqueda;
    const estados = new Set(estadosFiltro);
    const coincide = (p: FilaComparativoCodigo["prestadores"][number]) => {
      const variacion = referencia === "promedio" ? p.variacionPctPromedio : p.variacionPctMediana;
      return estados.has(clasificarSemaforo(variacion, umbrales));
    };
    return resultadoBusqueda
      .filter((fila) => fila.prestadores.some(coincide))
      .map((fila) => {
        const prestadoresFiltrados = fila.prestadores.filter(coincide);
        return { ...fila, prestadores: prestadoresFiltrados, cantidadPrestadores: prestadoresFiltrados.length };
      });
  }, [resultadoBusqueda, estadosFiltro, referencia, umbrales]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Tipo de tarifario</span>
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoComparativo)} className="w-56">
              {OPCIONES_TIPO.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-muted-foreground sm:ml-auto">
            Solo se muestran municipios/códigos con 2 o más prestadores vigentes — donde una comparación real es posible.
          </p>
        </CardContent>
      </Card>

      <PanelUmbrales
        umbrales={umbrales}
        onChange={(u) => {
          setUmbrales(u);
          setPagina(1);
        }}
        referencia={referencia}
        onChangeReferencia={(r) => {
          setReferencia(r);
          setPagina(1);
        }}
      />

      <Tabs defaultValue="municipio">
        <TabsList>
          <TabsTrigger value="municipio">Comparativo por municipio</TabsTrigger>
          <TabsTrigger value="codigo">Buscar código específico</TabsTrigger>
        </TabsList>

        <TabsContent value="municipio" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <Select
                value={municipioSeleccionado}
                onChange={(e) => {
                  setMunicipioSeleccionado(e.target.value);
                  setPagina(1);
                }}
                className="w-72"
                disabled={cargandoMunicipios || municipios.length === 0}
              >
                {municipios.length === 0 ? (
                  <option value="">
                    {cargandoMunicipios ? "Cargando municipios…" : "Sin municipios comparables para este tipo"}
                  </option>
                ) : (
                  departamentos.map((dep) => (
                    <optgroup key={dep.codigo} label={dep.nombre}>
                      {municipios
                        .filter((m) => m.departamentoCodigo === dep.codigo)
                        .map((m) => (
                          <option key={m.municipioCodigo} value={m.municipioCodigo}>
                            {m.municipioNombre} ({m.cantidadPrestadores} prestadores)
                          </option>
                        ))}
                    </optgroup>
                  ))
                )}
              </Select>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busquedaMunicipio}
                onChange={(e) => {
                  setBusquedaMunicipio(e.target.value);
                  setPagina(1);
                }}
                placeholder="Filtrar por código o descripción…"
                className="pl-8"
              />
            </div>
            <FiltroEstadosSemaforo
              seleccionados={estadosFiltro}
              onChange={(v) => {
                setEstadosFiltro(v);
                setPagina(1);
              }}
            />
            <div className="flex items-center gap-2 sm:ml-auto">
              <Badge>{resultadoMunicipio.total.toLocaleString("es-CO")} códigos comparables</Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={!municipioSeleccionado}
                asChild={Boolean(municipioSeleccionado)}
              >
                {municipioSeleccionado ? (
                  <a href={urlExportComparativo("municipio", "xlsx")} download>
                    <FileSpreadsheet className="h-4 w-4" /> Informe Excel
                  </a>
                ) : (
                  <span>
                    <FileSpreadsheet className="h-4 w-4" /> Informe Excel
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!municipioSeleccionado}
                asChild={Boolean(municipioSeleccionado)}
              >
                {municipioSeleccionado ? (
                  <a href={urlExportComparativo("municipio", "csv")} download>
                    <FileDown className="h-4 w-4" /> CSV
                  </a>
                ) : (
                  <span>
                    <FileDown className="h-4 w-4" /> CSV
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Contenedor con altura máxima + scroll propio: el encabezado
              (Código/Descripción/Prestadores/…) queda fijo arriba mientras
              se hace scroll entre muchas filas — pedido por el usuario
              2026-07-28, antes se perdía de vista qué significaba cada
              columna al bajar por una lista larga. */}
          <div className="max-h-[65vh] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-center">Prestadores</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Máximo</TableHead>
                  <TableHead className="text-right">{referencia === "promedio" ? "Promedio" : "Mediana"}</TableHead>
                  <TableHead className="text-right">Amplitud</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultadoMunicipio.filas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      {cargandoTabla ? "Cargando…" : "Sin códigos comparables para los criterios actuales."}
                    </TableCell>
                  </TableRow>
                ) : (
                  resultadoMunicipio.filas.map((fila) => (
                    <FilaExpandible
                      key={fila.codigoTarifa}
                      fila={{ ...fila, municipioNombre: "" }}
                      umbrales={umbrales}
                      referencia={referencia}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Paginacion
            page={resultadoMunicipio.page}
            totalPaginas={resultadoMunicipio.totalPaginas}
            total={resultadoMunicipio.total}
            pageSize={PAGE_SIZE}
            onPageChange={setPagina}
            cargando={cargandoTabla}
          />
        </TabsContent>

        <TabsContent value="codigo" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={codigoBusqueda}
                onChange={(e) => setCodigoBusqueda(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && buscarPorCodigo()}
                placeholder="Código CUPS/CUM/Insumo o parte de la descripción…"
                className="pl-8"
              />
            </div>
            <Select value={municipioBusqueda} onChange={(e) => setMunicipioBusqueda(e.target.value)} className="w-64">
              <option value="">Todos los municipios</option>
              {departamentos.map((dep) => (
                <optgroup key={dep.codigo} label={dep.nombre}>
                  {municipios
                    .filter((m) => m.departamentoCodigo === dep.codigo)
                    .map((m) => (
                      <option key={m.municipioCodigo} value={m.municipioCodigo}>
                        {m.municipioNombre}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
            <Button onClick={buscarPorCodigo} disabled={cargandoBusqueda || !codigoBusqueda.trim()}>
              Buscar
            </Button>
            <FiltroEstadosSemaforo seleccionados={estadosFiltro} onChange={setEstadosFiltro} />
            <div className="flex items-center gap-2 sm:ml-auto">
              <Button
                variant="outline"
                size="sm"
                disabled={!resultadoBusquedaFiltrado || resultadoBusquedaFiltrado.length === 0}
                asChild={Boolean(resultadoBusquedaFiltrado && resultadoBusquedaFiltrado.length > 0)}
              >
                {resultadoBusquedaFiltrado && resultadoBusquedaFiltrado.length > 0 ? (
                  <a href={urlExportComparativo("codigo", "xlsx")} download>
                    <FileSpreadsheet className="h-4 w-4" /> Informe Excel
                  </a>
                ) : (
                  <span>
                    <FileSpreadsheet className="h-4 w-4" /> Informe Excel
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!resultadoBusquedaFiltrado || resultadoBusquedaFiltrado.length === 0}
                asChild={Boolean(resultadoBusquedaFiltrado && resultadoBusquedaFiltrado.length > 0)}
              >
                {resultadoBusquedaFiltrado && resultadoBusquedaFiltrado.length > 0 ? (
                  <a href={urlExportComparativo("codigo", "csv")} download>
                    <FileDown className="h-4 w-4" /> CSV
                  </a>
                ) : (
                  <span>
                    <FileDown className="h-4 w-4" /> CSV
                  </span>
                )}
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
                  <TableHead>Municipio</TableHead>
                  <TableHead className="text-center">Prestadores</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Máximo</TableHead>
                  <TableHead className="text-right">{referencia === "promedio" ? "Promedio" : "Mediana"}</TableHead>
                  <TableHead className="text-right">Amplitud</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultadoBusquedaFiltrado === null ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                      Escriba un código o descripción y presione Buscar.
                    </TableCell>
                  </TableRow>
                ) : cargandoBusqueda ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                      Buscando…
                    </TableCell>
                  </TableRow>
                ) : resultadoBusquedaFiltrado.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                      {estadosFiltro.length > 0
                        ? "Ningún resultado tiene un prestador en el/los estado(s) seleccionados."
                        : "No se encontraron coincidencias con 2 o más prestadores en el mismo municipio."}
                    </TableCell>
                  </TableRow>
                ) : (
                  resultadoBusquedaFiltrado.map((fila) => (
                    <FilaExpandible
                      key={`${fila.municipioCodigo}-${fila.codigoTarifa}`}
                      fila={fila}
                      umbrales={umbrales}
                      referencia={referencia}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
