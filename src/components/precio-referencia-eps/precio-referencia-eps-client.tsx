"use client";

/**
 * Cliente del módulo "Precios de Referencia EPS" (pedido por el usuario
 * 2026-07-31): sube un archivo (CSV/TXT/XLSX) con columnas Nit_prestador,
 * Prestador, Municipio, Codigo, Descripcion, Precio — donde
 * "Nit_prestador"/"Prestador" identifican a la EPS/entidad pagadora de
 * referencia, no un prestador/IPS de Dusakawi — y lo persiste (UPSERT) en
 * `administrativo.negociacion_contratacion_precio_referencia_eps` (ver
 * src/app/actions/precio-referencia-eps-actions.ts).
 *
 * Primer módulo de este proyecto que ESCRIBE datos cargados por el usuario
 * (el resto son 100% solo lectura contra las tablas SIE) — de ahí que,
 * además de la carga, incluya una pantalla de consulta/depuración (filtros +
 * borrado individual/masivo) que los demás módulos no necesitan.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import UploadCloud from "lucide-react/icons/upload-cloud";
import AlertTriangle from "lucide-react/icons/alert-triangle";
import Loader2 from "lucide-react/icons/loader-2";
import Trash2 from "lucide-react/icons/trash-2";
import Search from "lucide-react/icons/search";
import CheckCircle2 from "lucide-react/icons/check-circle-2";
import DatabaseZap from "lucide-react/icons/database-zap";
import FileDown from "lucide-react/icons/file-down";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { formatearMoneda } from "@/lib/negociacion/formato";
import {
  obtenerCatalogoMunicipios,
  cargarPreciosReferenciaEps,
  listarPreciosReferenciaEps,
  eliminarPrecioReferenciaEps,
  eliminarPreciosReferenciaEpsPorEntidadMunicipio,
  verificarTablaPrecioReferenciaEps,
  aplicarMigracionPrecioReferenciaEps,
} from "@/app/actions/precio-referencia-eps-actions";
import type { MunicipioCatalogo, ResultadoCargaPrecioReferencia, FilaPrecioReferenciaEps } from "@/types/precio-referencia-eps";
import type { Rol } from "@/lib/auth";

const PAGE_SIZE = 25;

export function PrecioReferenciaEpsClient({ rolActual }: { rolActual: Rol | null }) {
  // --- Estado de la tabla en BD (migración 002 aplicada o no) ---
  const [existeTabla, setExisteTabla] = useState<boolean | null>(null);
  const [isPendingMigracion, startTransitionMigracion] = useTransition();
  const [pasosMigracion, setPasosMigracion] = useState<{ etiqueta: string; ok: boolean; error?: string }[] | null>(null);
  const [errorMigracion, setErrorMigracion] = useState<string | null>(null);

  function verificarTabla() {
    verificarTablaPrecioReferenciaEps()
      .then((r) => setExisteTabla(r.existe))
      .catch(() => setExisteTabla(false));
  }

  useEffect(() => {
    verificarTabla();
  }, []);

  function aplicarMigracion() {
    setErrorMigracion(null);
    setPasosMigracion(null);
    startTransitionMigracion(async () => {
      const respuesta = await aplicarMigracionPrecioReferenciaEps();
      if ("error" in respuesta) {
        setErrorMigracion(respuesta.error);
        return;
      }
      setPasosMigracion(respuesta.pasos);
      if (respuesta.ok) {
        setExisteTabla(true);
        setIntentoCarga((v) => v + 1);
        buscar(1);
      }
    });
  }

  // --- Catálogo de municipios (para el filtro y el borrado masivo) ---
  const [municipios, setMunicipios] = useState<MunicipioCatalogo[]>([]);
  const [cargandoMunicipios, setCargandoMunicipios] = useState(true);
  const [errorMunicipios, setErrorMunicipios] = useState<string | null>(null);
  const [intentoCarga, setIntentoCarga] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setCargandoMunicipios(true);
    setErrorMunicipios(null);
    obtenerCatalogoMunicipios()
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

  // --- Carga de archivo ---
  const [archivo, setArchivo] = useState<File | null>(null);
  const [isPendingCarga, startTransitionCarga] = useTransition();
  const [resultadoCarga, setResultadoCarga] = useState<ResultadoCargaPrecioReferencia | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  function cargarArchivo() {
    if (!archivo) return;
    setErrorCarga(null);
    setResultadoCarga(null);
    const fd = new FormData();
    fd.append("archivo", archivo);
    startTransitionCarga(async () => {
      const respuesta = await cargarPreciosReferenciaEps(fd);
      if ("error" in respuesta) {
        setErrorCarga(respuesta.error);
        return;
      }
      setResultadoCarga(respuesta);
      setArchivo(null);
      setPagina(1);
      buscar(1);
    });
  }

  // --- Filtros y listado ---
  const [municipioCodigo, setMunicipioCodigo] = useState("");
  const [entidadTexto, setEntidadTexto] = useState("");
  const [codigoTexto, setCodigoTexto] = useState("");
  const [pagina, setPagina] = useState(1);
  const [filas, setFilas] = useState<FilaPrecioReferenciaEps[]>([]);
  const [total, setTotal] = useState(0);
  const [cargandoListado, setCargandoListado] = useState(false);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<number | null>(null);

  function buscar(paginaBuscada?: number) {
    const paginaEfectiva = paginaBuscada ?? pagina;
    setCargandoListado(true);
    setErrorListado(null);
    listarPreciosReferenciaEps({
      municipioCodigo: municipioCodigo || undefined,
      entidadTexto: entidadTexto || undefined,
      codigoTexto: codigoTexto || undefined,
      pagina: paginaEfectiva,
      tamanoPagina: PAGE_SIZE,
    })
      .then((resultado) => {
        setFilas(resultado.filas);
        setTotal(resultado.total);
      })
      .catch((err: unknown) => {
        const mensaje = err instanceof Error ? err.message : "Error desconocido";
        setErrorListado(`No fue posible cargar el listado: ${mensaje}`);
      })
      .finally(() => setCargandoListado(false));
  }

  // Primera carga del listado al montar el componente.
  useEffect(() => {
    buscar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onCambiarPagina(nuevaPagina: number) {
    setPagina(nuevaPagina);
    buscar(nuevaPagina);
  }

  async function eliminarFila(id: number) {
    if (!window.confirm("¿Eliminar este precio de referencia? Esta acción no se puede deshacer.")) return;
    setEliminandoId(id);
    try {
      const respuesta = await eliminarPrecioReferenciaEps(id);
      if ("error" in respuesta) {
        alert(respuesta.error);
        return;
      }
      buscar(pagina);
    } finally {
      setEliminandoId(null);
    }
  }

  // --- Borrado masivo por EPS + municipio (para reemplazar una carga anterior) ---
  const [nitEliminar, setNitEliminar] = useState("");
  const [municipioEliminar, setMunicipioEliminar] = useState("");
  const [isPendingEliminarLote, startTransitionEliminarLote] = useTransition();
  const [resultadoEliminarLote, setResultadoEliminarLote] = useState<string | null>(null);

  function eliminarLote() {
    if (!nitEliminar.trim() || !municipioEliminar) return;
    if (!window.confirm(`¿Eliminar TODOS los precios de referencia de NIT ${nitEliminar} en ese municipio? Esta acción no se puede deshacer.`)) return;
    setResultadoEliminarLote(null);
    startTransitionEliminarLote(async () => {
      const respuesta = await eliminarPreciosReferenciaEpsPorEntidadMunicipio(nitEliminar, municipioEliminar);
      if ("error" in respuesta) {
        setResultadoEliminarLote(respuesta.error);
        return;
      }
      setResultadoEliminarLote(`Se eliminaron ${respuesta.eliminados} registro(s).`);
      buscar(1);
      setPagina(1);
    });
  }

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const opcionesMunicipio = useMemo(
    () => municipios.map((m) => ({ value: m.municipioCodigo, label: `${m.municipioNombre} (${m.departamentoNombre})` })),
    [municipios]
  );

  return (
    <div className="space-y-6">
      {existeTabla === false && (
        <Card className="border-amber-400 bg-amber-50/60">
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
              <DatabaseZap className="h-4 w-4" /> La tabla de este módulo aún no existe en la base de datos
            </p>
            <p className="text-xs text-amber-800/90">
              Falta aplicar la migración <code className="font-mono">002_precio_referencia_eps.sql</code>{" "}
              (crea <code className="font-mono">negociacion_contratacion_precio_referencia_eps</code>). Hasta entonces,
              la carga y consulta de este módulo fallará.
            </p>

            {rolActual === "admin" ? (
              <div className="space-y-2">
                <Button size="sm" onClick={aplicarMigracion} disabled={isPendingMigracion} className="bg-amber-700 hover:bg-amber-800">
                  {isPendingMigracion ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
                  {isPendingMigracion ? "Aplicando migración…" : "Aplicar migración"}
                </Button>
                {errorMigracion && <p className="text-xs text-destructive">{errorMigracion}</p>}
                {pasosMigracion && (
                  <ul className="space-y-1 text-xs">
                    {pasosMigracion.map((p, i) => (
                      <li key={i} className={p.ok ? "text-emerald-700" : "text-destructive"}>
                        {p.ok ? "✓" : "✗"} {p.etiqueta}
                        {p.error ? ` — ${p.error}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {pasosMigracion && !pasosMigracion.every((p) => p.ok) && (
                  <p className="text-xs text-muted-foreground">
                    Algún paso falló (por ejemplo, permisos insuficientes del usuario de base de datos). Puede
                    reintentar — cada paso es idempotente, no duplica nada si ya se aplicó parcialmente.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-amber-800/90">
                Solicite a un usuario con rol <strong>admin</strong> que ingrese a esta pantalla y aplique la
                migración, o que la aplique manualmente contra la base de datos.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col justify-between gap-2 rounded-md border border-dashed bg-muted/30 p-3 sm:flex-row sm:items-center">
            <p className="text-xs text-muted-foreground">
              ¿No tiene el archivo listo? Descargue la plantilla con las columnas correctas, un par de filas de
              ejemplo y la lista de municipios válidos — solo bórrelas y alimente sus datos reales.
            </p>
            <Button variant="outline" size="sm" asChild className="shrink-0">
              <a href="/api/export/precio-referencia-eps/plantilla" download>
                <FileDown className="h-4 w-4" />
                Descargar plantilla (Excel)
              </a>
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Archivo de precios de referencia (.csv, .txt o .xlsx — columnas Nit_prestador, Prestador, Municipio,
                Codigo, Descripcion, Precio)
              </label>
              <Input type="file" accept=".csv,.txt,.tsv,.xlsx" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex items-end">
              <Button onClick={cargarArchivo} disabled={!archivo || isPendingCarga} className="w-full sm:w-auto">
                {isPendingCarga ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {isPendingCarga ? "Cargando…" : "Cargar archivo"}
              </Button>
            </div>
          </div>

          {errorCarga && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorCarga}</span>
            </div>
          )}

          {resultadoCarga && (
            <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50/50 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Archivo &quot;{resultadoCarga.nombreArchivo}&quot; procesado
              </p>
              <p className="text-muted-foreground">
                {resultadoCarga.totalFilasArchivo} fila(s) en el archivo · {resultadoCarga.insertados} nuevas ·{" "}
                {resultadoCarga.actualizados} actualizadas
                {resultadoCarga.errores.length > 0 && ` · ${resultadoCarga.errores.length} con error`}
                {resultadoCarga.municipiosNoResueltos.length > 0 &&
                  ` · ${resultadoCarga.municipiosNoResueltos.reduce((acc, m) => acc + m.filas.length, 0)} fila(s) con municipio no resuelto`}
              </p>
              {resultadoCarga.errores.length > 0 && (
                <ul className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
                  {resultadoCarga.errores.map((e, i) => (
                    <li key={i}>
                      Fila {e.filaOriginal}: {e.motivo} {e.contenido ? `(${e.contenido})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {resultadoCarga.municipiosNoResueltos.length > 0 && (
                <ul className="max-h-32 overflow-y-auto text-xs text-amber-700">
                  {resultadoCarga.municipiosNoResueltos.map((m, i) => (
                    <li key={i}>
                      Filas {m.filas.join(", ")}: {m.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Municipio</label>
              <Select value={municipioCodigo} onChange={(e) => setMunicipioCodigo(e.target.value)} disabled={cargandoMunicipios}>
                <option value="">{cargandoMunicipios ? "Cargando…" : "Todos los municipios"}</option>
                {opcionesMunicipio.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {errorMunicipios && (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <span>{errorMunicipios}</span>
                  <button type="button" onClick={() => setIntentoCarga((v) => v + 1)} className="font-medium underline underline-offset-2">
                    Reintentar
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">EPS (nombre o NIT)</label>
              <Input value={entidadTexto} onChange={(e) => setEntidadTexto(e.target.value)} placeholder="Ej. Asmet Salud" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Código o descripción</label>
              <Input value={codigoTexto} onChange={(e) => setCodigoTexto(e.target.value)} placeholder="Ej. Rivaroxaban" />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setPagina(1);
                  buscar(1);
                }}
                disabled={cargandoListado}
              >
                {cargandoListado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar
              </Button>
            </div>
          </div>

          {errorListado && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorListado}</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EPS</TableHead>
                  <TableHead>Municipio</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead>Actualizado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <div className="font-medium">{f.nombreEntidad}</div>
                      <div className="font-mono text-xs text-muted-foreground">{f.nitEntidad}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.municipioNombre} ({f.departamentoNombre})
                    </TableCell>
                    <TableCell className="font-mono text-xs">{f.codigo}</TableCell>
                    <TableCell className="max-w-[280px] whitespace-normal break-words">{f.descripcion}</TableCell>
                    <TableCell className="text-right font-medium">{formatearMoneda(f.precio)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(f.fechaActualizado).toLocaleDateString("es-CO")}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => eliminarFila(f.id)} disabled={eliminandoId === f.id}>
                        {eliminandoId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filas.length === 0 && !cargandoListado && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Sin registros — cargue un archivo o ajuste los filtros.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <Paginacion page={pagina} totalPaginas={totalPaginas} total={total} pageSize={PAGE_SIZE} onPageChange={onCambiarPagina} cargando={cargandoListado} />
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">Eliminar una carga completa (EPS + municipio)</p>
          <p className="text-xs text-muted-foreground">
            Útil para depurar/reemplazar una carga anterior antes de subir una versión corregida del mismo archivo.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input value={nitEliminar} onChange={(e) => setNitEliminar(e.target.value)} placeholder="NIT de la EPS" />
            <Select value={municipioEliminar} onChange={(e) => setMunicipioEliminar(e.target.value)} disabled={cargandoMunicipios}>
              <option value="">Seleccione un municipio…</option>
              {opcionesMunicipio.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Button variant="destructive" onClick={eliminarLote} disabled={!nitEliminar.trim() || !municipioEliminar || isPendingEliminarLote}>
              {isPendingEliminarLote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar
            </Button>
          </div>
          {resultadoEliminarLote && <p className="text-xs text-muted-foreground">{resultadoEliminarLote}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
