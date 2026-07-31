"use client";

/**
 * Cliente del módulo "Análisis de Propuesta del Prestador".
 *
 * El usuario sube un archivo (CSV/TXT/XLSX) con columnas Código + Precio
 * Ofertado, elige el municipio donde se presta el servicio/medicamento/
 * insumo, y el servidor evalúa cada código contra el tarifario YA
 * contratado en ese municipio (mediana/promedio, quién lo presta, sus
 * ofertas más favorables y en qué contrato) — ver
 * src/app/actions/analisis-propuesta-actions.ts.
 *
 * Se invoca la Server Action con `FormData` (incluye el `File`) en vez de
 * argumentos planos como el resto del proyecto — es el único módulo que
 * necesita subir un archivo binario desde el cliente. Mismo patrón
 * `useTransition` + Server Action ya establecido (ver
 * KnowledgeBase/03-Frontend/Hooks.md), solo cambia el tipo de argumento.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import UploadCloud from "lucide-react/icons/upload-cloud";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import FileDown from "lucide-react/icons/file-down";
import ChevronDown from "lucide-react/icons/chevron-down";
import ChevronRight from "lucide-react/icons/chevron-right";
import AlertTriangle from "lucide-react/icons/alert-triangle";
import Loader2 from "lucide-react/icons/loader-2";
import ListFilter from "lucide-react/icons/list-filter";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { formatearMoneda, formatearPorcentaje } from "@/lib/negociacion/formato";
import { etiquetaNivelSemaforo } from "@/lib/negociacion/comparativo";
import { colorSemaforo } from "@/components/comparativo/semaforo-ui";
import { getOpcionesMunicipiosPropuesta, evaluarPropuestaPrestador } from "@/app/actions/analisis-propuesta-actions";
import { UMBRALES_SEMAFORO_DEFECTO } from "@/types/comparativo";
import type { ReferenciaVariacion, UmbralesSemaforo } from "@/types/comparativo";
import type { FilaEvaluacionPropuesta, OpcionMunicipioPropuesta, ResultadoAnalisisPropuesta } from "@/types/analisis-propuesta";

const PAGE_SIZE = 25;

const ETIQUETAS_TIPO: Record<string, string> = {
  servicios: "Procedimiento (CUPS)",
  medicamentos: "Medicamento (CUM)",
  insumos: "Insumo",
  noEncontrado: "No identificado",
};

type VistaExportacion = "completo" | "contrapropuesta";

function construirFormData(params: {
  archivo: File;
  municipioCodigo: string;
  referencia: ReferenciaVariacion;
  umbrales: UmbralesSemaforo;
}): FormData {
  const fd = new FormData();
  fd.append("archivo", params.archivo);
  fd.append("municipioCodigo", params.municipioCodigo);
  fd.append("referencia", params.referencia);
  fd.append("alertaPct", String(params.umbrales.alertaPct));
  fd.append("criticoPct", String(params.umbrales.criticoPct));
  return fd;
}

/** Descarga el resultado desde el Route Handler binario — a diferencia de los demás exports del proyecto (enlace GET simple), aquí hay que reenviar el mismo archivo subido, así que se hace por POST + blob. `vista` elige entre el análisis completo (uso interno) y la contrapropuesta (documento a entregar al prestador). */
async function descargarExportacion(
  formato: "xlsx" | "csv",
  vista: VistaExportacion,
  params: { archivo: File; municipioCodigo: string; referencia: ReferenciaVariacion; umbrales: UmbralesSemaforo }
) {
  const fd = construirFormData(params);
  fd.append("formato", formato);
  fd.append("vista", vista);
  const respuesta = await fetch("/api/export/analisis-propuesta", { method: "POST", body: fd });
  if (!respuesta.ok) {
    alert("No fue posible generar la exportación.");
    return;
  }
  const blob = await respuesta.blob();
  const url = URL.createObjectURL(blob);
  const nombreBase = vista === "contrapropuesta" ? "Contrapropuesta_Prestador" : "Analisis_Propuesta_Prestador";
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `${nombreBase}.${formato === "xlsx" ? "xlsx" : "csv"}`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

/**
 * Una fila de la tabla del acordeón: un prestador real de la red propia de
 * Dusakawi, un precio de referencia reportado por OTRA EPS (tabla
 * `negociacion_contratacion_precio_referencia_eps`, ver
 * src/types/precio-referencia-eps.ts), o la propuesta recibida del archivo
 * — todas mezcladas y ordenadas por valor para que el analista vea de un
 * vistazo dónde queda su propuesta frente al mercado completo.
 */
interface FilaTablaReferencia {
  key: string;
  origen: "prestador" | "mercadoEps" | "propuesta";
  etiqueta: string;
  nit: string;
  numeroContrato: string;
  valorFinal: number;
  porDebajoDeMediana?: boolean;
  porDebajoDePropuesta?: boolean;
}

function construirFilasAcordeon(fila: FilaEvaluacionPropuesta): FilaTablaReferencia[] {
  const filas: FilaTablaReferencia[] = fila.prestadoresReferencia.map((p) => ({
    key: `prestador-${p.ips}-${p.numeroContrato}`,
    origen: "prestador",
    etiqueta: p.razonSocial,
    nit: p.nit,
    numeroContrato: p.numeroContrato,
    valorFinal: p.valorFinal,
    porDebajoDeMediana: p.porDebajoDeMediana,
    porDebajoDePropuesta: p.porDebajoDePropuesta,
  }));

  for (const r of fila.referenciasMercadoEps) {
    filas.push({
      key: `mercadoEps-${r.nitEntidad}`,
      origen: "mercadoEps",
      etiqueta: `${r.nombreEntidad} (mercado)`,
      nit: r.nitEntidad,
      numeroContrato: "—",
      valorFinal: r.precio,
      porDebajoDePropuesta: r.precio < fila.precioOfertado,
    });
  }

  filas.push({
    key: "propuesta",
    origen: "propuesta",
    etiqueta: "Propuesta recibida del prestador (este archivo)",
    nit: "—",
    numeroContrato: "—",
    valorFinal: fila.precioOfertado,
  });

  return filas.sort((a, b) => a.valorFinal - b.valorFinal);
}

function TarjetaResumen({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{etiqueta}</p>
        <p className="text-2xl font-bold tracking-tight">{valor}</p>
        {nota && <p className="mt-1 text-xs text-muted-foreground">{nota}</p>}
      </CardContent>
    </Card>
  );
}

function FilaResultado({ fila, referencia }: { fila: FilaEvaluacionPropuesta; referencia: ReferenciaVariacion }) {
  const [abierto, setAbierto] = useState(false);
  const valorReferencia = referencia === "promedio" ? fila.promedio : fila.mediana;
  const variacionPct = referencia === "promedio" ? fila.variacionPctPromedio : fila.variacionPctMediana;
  const filasAcordeon = useMemo(() => construirFilasAcordeon(fila), [fila]);
  const tieneReferenciaMercadoEps = fila.referenciasMercadoEps.length > 0;
  const tieneReferenciaMasEconomicaEps = fila.referenciasMercadoEps.some((r) => r.precio < fila.precioOfertado);
  const puedeExpandir = fila.cantidadPrestadoresReferencia > 0 || tieneReferenciaMercadoEps;

  return (
    <>
      <TableRow className={abierto ? "bg-muted/40" : undefined}>
        <TableCell>
          {puedeExpandir && (
            <button
              type="button"
              onClick={() => setAbierto((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Ver dónde queda mi propuesta frente a otros prestadores"
            >
              {abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </TableCell>
        <TableCell className="font-mono text-xs">{fila.codigo}</TableCell>
        <TableCell className="max-w-[280px] whitespace-normal break-words">{fila.descripcion}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{ETIQUETAS_TIPO[fila.tipo] ?? fila.tipo}</TableCell>
        <TableCell className="text-right font-medium">{formatearMoneda(fila.precioOfertado)}</TableCell>
        <TableCell className="text-right">{valorReferencia !== null ? formatearMoneda(valorReferencia) : "—"}</TableCell>
        <TableCell className="text-right">{variacionPct !== null ? formatearPorcentaje(variacionPct) : "—"}</TableCell>
        <TableCell className="whitespace-nowrap">
          {fila.nivel === "sinReferencia" ? (
            <Badge variant="outline" className="whitespace-nowrap text-muted-foreground">
              Sin referencia
            </Badge>
          ) : (
            <Badge className={`whitespace-nowrap ${colorSemaforo(fila.nivel)}`}>{etiquetaNivelSemaforo(fila.nivel)}</Badge>
          )}
        </TableCell>
        <TableCell className="text-center">{fila.cantidadPrestadoresReferencia}</TableCell>
        <TableCell className="text-center">
          {tieneReferenciaMercadoEps ? (
            <Badge variant="outline" className={tieneReferenciaMasEconomicaEps ? "border-violet-600 text-violet-700" : "text-muted-foreground"}>
              {fila.referenciasMercadoEps.length}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>
      {abierto && puedeExpandir && (
        <TableRow>
          <TableCell colSpan={10} className="bg-muted/20 p-0">
            <div className="p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Su propuesta, ubicada entre los prestadores que ya tienen contratado este código en el municipio y
                los precios reportados por otras EPS — ordenados de menor a mayor valor:
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prestador / EPS</TableHead>
                    <TableHead>NIT</TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Referencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filasAcordeon.map((f) => (
                    <TableRow
                      key={f.key}
                      className={
                        f.origen === "propuesta"
                          ? "border-l-4 border-amber-500 bg-amber-50/70"
                          : f.origen === "mercadoEps"
                            ? "border-l-4 border-violet-500 bg-violet-50/60"
                            : undefined
                      }
                    >
                      <TableCell className={f.origen !== "prestador" ? "font-semibold" : undefined}>{f.etiqueta}</TableCell>
                      <TableCell className="font-mono text-xs">{f.nit}</TableCell>
                      <TableCell className="font-mono text-xs">{f.numeroContrato}</TableCell>
                      <TableCell className={`text-right ${f.origen !== "prestador" ? "font-semibold" : "font-medium"}`}>
                        {formatearMoneda(f.valorFinal)}
                      </TableCell>
                      <TableCell className="space-x-1">
                        {f.origen === "propuesta" && (
                          <Badge variant="outline" className="border-amber-500 text-amber-700">
                            Su propuesta
                          </Badge>
                        )}
                        {f.origen === "mercadoEps" && (
                          <Badge variant="outline" className="border-violet-600 text-violet-700">
                            Precio de mercado (otra EPS)
                          </Badge>
                        )}
                        {f.origen === "prestador" && f.porDebajoDePropuesta && (
                          <Badge variant="outline" className="border-emerald-600 text-emerald-700">
                            Más barato que la oferta
                          </Badge>
                        )}
                        {f.origen === "prestador" && f.porDebajoDeMediana && !f.porDebajoDePropuesta && (
                          <Badge variant="outline" className="border-sky-600 text-sky-700">
                            Por debajo de la mediana
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function AnalisisPropuestaClient() {
  const [municipios, setMunicipios] = useState<OpcionMunicipioPropuesta[]>([]);
  const [municipioCodigo, setMunicipioCodigo] = useState("");
  const [cargandoMunicipios, setCargandoMunicipios] = useState(true);
  const [errorMunicipios, setErrorMunicipios] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [referencia, setReferencia] = useState<ReferenciaVariacion>("promedio");
  const [umbrales, setUmbrales] = useState<UmbralesSemaforo>(UMBRALES_SEMAFORO_DEFECTO);
  const [resultado, setResultado] = useState<ResultadoAnalisisPropuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();
  const [exportando, setExportando] = useState<`${VistaExportacion}-${"xlsx" | "csv"}` | null>(null);
  const [intentoCarga, setIntentoCarga] = useState(0);

  // Sin `.catch` explícito el error queda silencioso (solo visible como
  // "Uncaught (in promise)" en la consola del navegador) — el select de
  // municipio se quedaba mostrando solo el placeholder sin ninguna pista de
  // qué había fallado. Se agrega estado de carga/error explícito, mismo
  // criterio de transparencia que el resto del proyecto (nunca fallar en
  // silencio), más un botón de reintentar.
  useEffect(() => {
    let cancelado = false;
    setCargandoMunicipios(true);
    setErrorMunicipios(null);
    getOpcionesMunicipiosPropuesta()
      .then((data) => {
        if (cancelado) return;
        setMunicipios(data);
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        const mensaje = err instanceof Error ? err.message : "Error desconocido";
        setErrorMunicipios(`No fue posible cargar la lista de municipios: ${mensaje}`);
      })
      .finally(() => {
        if (!cancelado) setCargandoMunicipios(false);
      });
    return () => {
      cancelado = true;
    };
  }, [intentoCarga]);

  function analizar() {
    if (!archivo || !municipioCodigo) return;
    setError(null);
    const fd = construirFormData({ archivo, municipioCodigo, referencia, umbrales });
    startTransition(async () => {
      const respuesta = await evaluarPropuestaPrestador(fd);
      if ("error" in respuesta) {
        setError(respuesta.error);
        setResultado(null);
        return;
      }
      setResultado(respuesta);
      setPage(1);
    });
  }

  const filasOrdenadas = useMemo(() => {
    if (!resultado) return [];
    const filas = [...resultado.filas];
    filas.sort((a, b) => {
      // Sin referencia siempre al final — no hay nada que priorizar ahí.
      if (a.nivel === "sinReferencia" && b.nivel !== "sinReferencia") return 1;
      if (b.nivel === "sinReferencia" && a.nivel !== "sinReferencia") return -1;
      const varA = (referencia === "promedio" ? a.variacionPctPromedio : a.variacionPctMediana) ?? 0;
      const varB = (referencia === "promedio" ? b.variacionPctPromedio : b.variacionPctMediana) ?? 0;
      return varB - varA; // más caro que el mercado primero — prioridad de negociación
    });
    return filas;
  }, [resultado, referencia]);

  const totalPaginas = Math.max(1, Math.ceil(filasOrdenadas.length / PAGE_SIZE));
  const filasPagina = filasOrdenadas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function exportar(formato: "xlsx" | "csv", vista: VistaExportacion) {
    if (!archivo || !municipioCodigo) return;
    setExportando(`${vista}-${formato}`);
    try {
      await descargarExportacion(formato, vista, { archivo, municipioCodigo, referencia, umbrales });
    } finally {
      setExportando(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="print:hidden">
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 lg:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">
                Archivo de propuesta (.csv, .txt o .xlsx — columnas &quot;Código&quot; y &quot;Precio Ofertado&quot;)
              </label>
              <Input
                type="file"
                accept=".csv,.txt,.tsv,.xlsx"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Municipio donde se presta</label>
              <Select
                value={municipioCodigo}
                onChange={(e) => setMunicipioCodigo(e.target.value)}
                disabled={cargandoMunicipios || municipios.length === 0}
              >
                <option value="">
                  {cargandoMunicipios
                    ? "Cargando municipios…"
                    : municipios.length === 0
                      ? "Sin municipios disponibles"
                      : "Seleccione un municipio…"}
                </option>
                {municipios.map((m) => (
                  <option key={m.municipioCodigo} value={m.municipioCodigo}>
                    {m.municipioNombre} ({m.departamentoNombre})
                  </option>
                ))}
              </Select>
              {errorMunicipios && (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <span>{errorMunicipios}</span>
                  <button
                    type="button"
                    onClick={() => setIntentoCarga((v) => v + 1)}
                    className="font-medium underline underline-offset-2 hover:text-destructive/80"
                  >
                    Reintentar
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-end">
              <Button onClick={analizar} disabled={!archivo || !municipioCodigo || isPending} className="w-full">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {isPending ? "Analizando…" : "Analizar propuesta"}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end sm:gap-6">
            <div className="flex items-center gap-2">
              <ListFilter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Umbrales del semáforo</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground" title="La mediana no se distorsiona por un prestador con un valor muy alto o muy bajo dentro del mismo municipio; el promedio sí.">
                Comparar contra
              </label>
              <Select value={referencia} onChange={(e) => setReferencia(e.target.value as ReferenciaVariacion)} className="w-40">
                <option value="promedio">Promedio</option>
                <option value="mediana">Mediana (recomendado)</option>
              </Select>
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
              La propuesta se compara contra {referencia === "promedio" ? "el promedio" : "la mediana"} de lo YA
              contratado en el municipio elegido
              {referencia === "promedio"
                ? " — un solo prestador con un valor muy alto o muy bajo puede desplazar el promedio de todo el municipio; use Mediana si sospecha eso."
                : " (no se distorsiona por valores extremos de uno o dos prestadores)."}
              {" "}Más caro que el mercado → <span className="font-medium text-amber-600">Alerta</span>/
              <span className="font-medium text-red-600">Crítico</span> (punto de negociación). Más barato →{" "}
              <span className="font-medium text-sky-600">Favorable</span>.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {resultado && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <TarjetaResumen etiqueta="Códigos en la propuesta" valor={String(resultado.resumen.totalCodigos)} />
            <TarjetaResumen
              etiqueta="Con referencia de mercado"
              valor={String(resultado.resumen.totalConReferencia)}
              nota={resultado.resumen.totalSinReferencia > 0 ? `${resultado.resumen.totalSinReferencia} sin referencia` : undefined}
            />
            <TarjetaResumen etiqueta="Favorables o iguales al mercado" valor={String(resultado.resumen.totalFavorables)} />
            <TarjetaResumen etiqueta="A negociar (más caros que el mercado)" valor={String(resultado.resumen.totalCriticos)} />
            <TarjetaResumen
              etiqueta="Ahorro potencial vs. mediana"
              valor={formatearMoneda(resultado.resumen.ahorroPotencialUnitarioVsMediana)}
              nota="Por unidad tarifada, no proyectado por volumen de consumo real"
            />
          </div>

          {resultado.erroresParseo.length > 0 && (
            <Card className="border-amber-300">
              <CardContent className="space-y-1 pt-6">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-700">
                  <AlertTriangle className="h-4 w-4" /> {resultado.erroresParseo.length} fila(s) del archivo no se pudieron procesar
                </p>
                <ul className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
                  {resultado.erroresParseo.map((e, i) => (
                    <li key={i}>
                      Fila {e.filaOriginal}: {e.motivo} {e.contenido ? `(${e.contenido})` : ""}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card className="border-emerald-300 bg-emerald-50/40">
            <CardContent className="flex flex-col justify-between gap-3 pt-6 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-medium">Documento de contrapropuesta (uso interno)</p>
                <p className="text-xs text-muted-foreground">
                  Código, nombre del procedimiento/medicamento/insumo, precio ofertado y — solo si existen — un grupo
                  de columnas por cada valor más económico ya conocido que la propuesta (Opción, Fuente, Prestador/EPS
                  y Contrato), para que el negociador elija cuál usar. Incluye la identidad completa de cada fuente
                  (prestador propio o EPS) y el número de contrato — revíselo antes de compartirlo con un prestador
                  externo.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => exportar("xlsx", "contrapropuesta")} disabled={exportando !== null}>
                  {exportando === "contrapropuesta-xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  Contrapropuesta (Excel)
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportar("csv", "contrapropuesta")} disabled={exportando !== null}>
                  {exportando === "contrapropuesta-csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  CSV
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <p className="text-sm text-muted-foreground">
                  Municipio: <span className="font-medium text-foreground">{resultado.municipioNombre} ({resultado.departamentoNombre})</span>
                  {" · "}Archivo: <span className="font-medium text-foreground">{resultado.nombreArchivo}</span>
                </p>
                <div className="flex gap-2">
                  <p className="self-center text-xs text-muted-foreground">Análisis completo (uso interno):</p>
                  <Button variant="outline" size="sm" onClick={() => exportar("xlsx", "completo")} disabled={exportando !== null}>
                    {exportando === "completo-xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportar("csv", "completo")} disabled={exportando !== null}>
                    {exportando === "completo-csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                    CSV
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead>Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Precio ofertado</TableHead>
                      <TableHead className="text-right">{referencia === "promedio" ? "Promedio" : "Mediana"} municipio</TableHead>
                      <TableHead className="text-right">Variación %</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-center">Prestadores</TableHead>
                      <TableHead className="text-center" title="Precios reportados por otras EPS para este código en este municipio">
                        Mercado
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filasPagina.map((fila) => (
                      <FilaResultado key={`${fila.codigo}-${fila.filaOriginal}`} fila={fila} referencia={referencia} />
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Paginacion
                page={page}
                totalPaginas={totalPaginas}
                total={filasOrdenadas.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
