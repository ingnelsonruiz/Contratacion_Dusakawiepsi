"use client";

import { useEffect, useMemo, useState } from "react";
import Search from "lucide-react/icons/search";
import CalendarDays from "lucide-react/icons/calendar-days";
import ArrowDownUp from "lucide-react/icons/arrow-down-up";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import FileDown from "lucide-react/icons/file-down";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { formatearMoneda, formatearFecha } from "@/lib/negociacion/formato";
import { validarRangoConsumo, MAX_DIAS_RANGO_CONSUMO } from "@/lib/negociacion/consumo-frecuencia";
import {
  getOpcionesPrestadoresConsumo,
  getConsumoPrestador,
  getContratosPrestadorConsumo,
} from "@/app/actions/consumo-frecuencia-actions";
import type {
  OpcionPrestadorConsumo,
  OpcionContratoConsumo,
  ResultadoConsumoContrato,
  ResultadoConsumoPrestador,
  TipoConsumo,
} from "@/types/consumo-frecuencia";

const PAGE_SIZE = 25;

const ETIQUETAS_TIPO: Record<TipoConsumo, string> = {
  servicios: "Procedimiento (CUPS)",
  medicamentos: "Medicamento (CUM)",
  insumos: "Insumo",
};

// El sistema tiene datos reales desde 2020 (verificado 2026-07-28) hasta hoy.
// Acota el <input type="date"> nativo (min/max) — el navegador deshabilita en
// su propio selector cualquier día fuera de este rango, sin validación manual.
const FECHA_MINIMA = "2020-01-01";

function aIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function TarjetaKpi({ etiqueta, valor, sub }: { etiqueta: string; valor: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-medium text-muted-foreground">{etiqueta}</p>
        <p className="mt-1 text-xl font-bold">{valor}</p>
        {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export function ConsumoFrecuenciaClient() {
  const [prestadores, setPrestadores] = useState<OpcionPrestadorConsumo[]>([]);
  const [cargandoPrestadores, setCargandoPrestadores] = useState(true);
  const [busquedaPrestador, setBusquedaPrestador] = useState("");
  const [codigoPrestadorSeleccionado, setCodigoPrestadorSeleccionado] = useState("");

  const hoy = new Date();
  // Por defecto, el mes calendario completo anterior — el mes en curso casi
  // siempre está incompleto (facturación/radicación con rezago normal).
  const primerDiaMesAnterior = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - 1, 1));
  const ultimoDiaMesAnterior = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), 0));
  const [fechaInicio, setFechaInicio] = useState(aIso(primerDiaMesAnterior));
  const [fechaFin, setFechaFin] = useState(aIso(ultimoDiaMesAnterior));

  // Única fuente de verdad del tope de rango (~1 año) — misma función que
  // valida en el servidor (Server Action y export), ver
  // src/lib/negociacion/consumo-frecuencia.ts.
  const validacionRango = useMemo(() => validarRangoConsumo(fechaInicio, fechaFin), [fechaInicio, fechaFin]);

  const [resultado, setResultado] = useState<ResultadoConsumoPrestador | null>(null);
  const [cargandoResultado, setCargandoResultado] = useState(false);
  const [consultado, setConsultado] = useState(false);
  const [errorConsulta, setErrorConsulta] = useState<string | null>(null);

  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoConsumo>("todos");
  const [orden, setOrden] = useState<"valor_desc" | "valor_asc" | "cantidad_desc" | "cantidad_asc">("valor_desc");
  const [pagina, setPagina] = useState(1);

  // Consumo por contrato (2026-08-02, pedido del usuario: "necesito saber el
  // consumo por contrato... para cuando se hagan otrosí o ampliaciones saber
  // qué consumos han tenido"). Independiente del flujo principal de arriba —
  // no lo modifica ni depende de él.
  const [contratosPrestador, setContratosPrestador] = useState<OpcionContratoConsumo[]>([]);
  const [cargandoContratos, setCargandoContratos] = useState(false);
  const [contratosSeleccionados, setContratosSeleccionados] = useState<Set<string>>(new Set());
  const [resultadosPorContrato, setResultadosPorContrato] = useState<ResultadoConsumoContrato[] | null>(null);
  const [cargandoPorContrato, setCargandoPorContrato] = useState(false);
  const [contratoEnDetalle, setContratoEnDetalle] = useState<string | null>(null);

  useEffect(() => {
    getOpcionesPrestadoresConsumo()
      .then(setPrestadores)
      .finally(() => setCargandoPrestadores(false));
  }, []);

  // Al cambiar de prestador, se recarga su lista de contratos y se limpia
  // cualquier desglose por contrato que hubiera quedado del prestador anterior.
  useEffect(() => {
    setContratosSeleccionados(new Set());
    setResultadosPorContrato(null);
    setContratoEnDetalle(null);
    if (!codigoPrestadorSeleccionado) {
      setContratosPrestador([]);
      return;
    }
    setCargandoContratos(true);
    getContratosPrestadorConsumo(codigoPrestadorSeleccionado)
      .then(setContratosPrestador)
      .finally(() => setCargandoContratos(false));
  }, [codigoPrestadorSeleccionado]);

  function alternarContrato(numeroContrato: string) {
    setContratosSeleccionados((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(numeroContrato)) nuevo.delete(numeroContrato);
      else nuevo.add(numeroContrato);
      return nuevo;
    });
  }

  /**
   * Ejecuta `getConsumoPrestador` una vez POR CONTRATO seleccionado, con el
   * MISMO rango de fechas elegido arriba para todos — la diferencia entre
   * contratos es el filtro exacto `numero_contrato = ANY(...)` aplicado en
   * el servidor (ver `construirFragmentoRango` en
   * `consumo-frecuencia-actions.ts`), no una ventana de fechas distinta por
   * contrato.
   *
   * CORRECCIÓN 2026-08-02: hasta esta versión, aquí se intersectaba el rango
   * elegido con la vigencia de cada contrato (`intersectarVigenciaConRango`,
   * ya eliminada) porque se creía que los RIPS no registraban bajo qué
   * contrato se facturó un servicio. El usuario corrigió esa suposición
   * ("en la factura va el número de contrato") y se verificó en la BD real:
   * `rips_af.numero_contrato` existe y coincide exactamente con
   * `ct_ips_contrato`. Ahora el filtro es exacto, no por fecha.
   *
   * Secuencial (no Promise.all), mismo criterio de confiabilidad que el
   * resto del proyecto ante consultas pesadas repetidas contra el proxy.
   */
  async function desglosarPorContrato() {
    if (contratosSeleccionados.size === 0 || !validacionRango.valido) return;
    setCargandoPorContrato(true);
    setContratoEnDetalle(null);
    const seleccionados = contratosPrestador.filter((c) => contratosSeleccionados.has(c.numeroContrato));
    const acumulado: ResultadoConsumoContrato[] = seleccionados.map((contrato) => ({
      contrato,
      resultado: null,
      cargando: true,
      error: null,
    }));
    setResultadosPorContrato(acumulado);

    for (let i = 0; i < seleccionados.length; i++) {
      const contrato = seleccionados[i];
      try {
        const res = await getConsumoPrestador(codigoPrestadorSeleccionado, fechaInicio, fechaFin, [contrato.numeroContrato]);
        acumulado[i] = { contrato, resultado: res, cargando: false, error: null };
      } catch (e: any) {
        acumulado[i] = { contrato, resultado: null, cargando: false, error: e?.message ?? "No fue posible consultar este contrato." };
      }
      setResultadosPorContrato([...acumulado]);
    }
    setCargandoPorContrato(false);
  }

  /** CSV liviano del resumen por contrato — armado en el navegador (sin ruta nueva en el servidor) porque es solo un resumen de lo que ya está en pantalla. */
  function exportarResumenContratoCsv() {
    if (!resultadosPorContrato) return;
    const encabezado = ["Contrato", "Vigencia contrato", "Facturas", "Códigos distintos", "Valor total facturado"];
    const filasCsv = resultadosPorContrato.map((r) => [
      r.contrato.numeroContrato,
      `${r.contrato.fechaInicio} a ${r.contrato.fechaTerminacion}`,
      r.resultado ? String(r.resultado.kpis.cantidadFacturas) : "0",
      r.resultado ? String(r.resultado.kpis.cantidadCodigosDistintos) : "0",
      r.resultado ? String(r.resultado.kpis.valorTotalFacturado) : "0",
    ]);
    const csv = [encabezado, ...filasCsv].map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Consumo_por_contrato_${codigoPrestadorSeleccionado}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const prestadoresFiltrados = useMemo(() => {
    const q = busquedaPrestador.trim().toLowerCase();
    if (!q) return prestadores;
    return prestadores.filter((p) => p.razonSocial.toLowerCase().includes(q) || p.nit.includes(q) || p.codigoPrestador.includes(q));
  }, [prestadores, busquedaPrestador]);

  async function consultar() {
    if (!codigoPrestadorSeleccionado || !validacionRango.valido) return;
    setCargandoResultado(true);
    setConsultado(true);
    setErrorConsulta(null);
    setPagina(1);
    try {
      const res = await getConsumoPrestador(codigoPrestadorSeleccionado, fechaInicio, fechaFin);
      setResultado(res);
    } catch (e: any) {
      // getConsumoPrestador valida el rango también en el servidor (defensa
      // en profundidad) y lanza si algo no cuadra — se muestra tal cual, ya
      // que el mensaje viene de la misma validarRangoConsumo() del cliente.
      setResultado(null);
      setErrorConsulta(e?.message ?? "No fue posible consultar el consumo de este prestador.");
    } finally {
      setCargandoResultado(false);
    }
  }

  const filasFiltradas = useMemo(() => {
    if (!resultado) return [];
    const filtradas = resultado.filas.filter((f) => filtroTipo === "todos" || f.tipo === filtroTipo);
    const ordenadas = [...filtradas].sort((a, b) => {
      switch (orden) {
        case "valor_desc":
          return b.valorTotal - a.valorTotal;
        case "valor_asc":
          return a.valorTotal - b.valorTotal;
        case "cantidad_desc":
          return b.cantidad - a.cantidad;
        case "cantidad_asc":
          return a.cantidad - b.cantidad;
      }
    });
    return ordenadas;
  }, [resultado, filtroTipo, orden]);

  const totalPaginas = Math.max(1, Math.ceil(filasFiltradas.length / PAGE_SIZE));
  const filasPagina = filasFiltradas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  function urlExport(formato: "xlsx" | "csv"): string {
    const params = new URLSearchParams({
      codigoPrestador: codigoPrestadorSeleccionado,
      fechaInicio,
      fechaFin,
      formato,
    });
    if (filtroTipo !== "todos") params.set("tipo", filtroTipo);
    return `/api/export/consumo-frecuencia?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busquedaPrestador}
                onChange={(e) => setBusquedaPrestador(e.target.value)}
                placeholder="Buscar por nombre, NIT o código…"
                className="pl-8"
                disabled={cargandoPrestadores}
              />
            </div>
            <Select
              value={codigoPrestadorSeleccionado}
              onChange={(e) => setCodigoPrestadorSeleccionado(e.target.value)}
              className="w-72"
              disabled={cargandoPrestadores || prestadoresFiltrados.length === 0}
            >
              <option value="">{cargandoPrestadores ? "Cargando prestadores…" : "Seleccione un prestador…"}</option>
              {prestadoresFiltrados.map((p) => (
                <option key={p.codigoPrestador} value={p.codigoPrestador}>
                  {p.razonSocial} — NIT {p.nit}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                type="date"
                value={fechaInicio}
                min={FECHA_MINIMA}
                max={fechaFin}
                onChange={(e) => e.target.value && setFechaInicio(e.target.value)}
                className="w-36"
                aria-label="Fecha inicial"
              />
              <span className="text-sm text-muted-foreground">a</span>
              <Input
                type="date"
                value={fechaFin}
                min={fechaInicio}
                max={aIso(hoy)}
                onChange={(e) => e.target.value && setFechaFin(e.target.value)}
                className="w-36"
                aria-label="Fecha final"
              />
            </div>
            <Button onClick={consultar} disabled={!codigoPrestadorSeleccionado || !validacionRango.valido || cargandoResultado}>
              Consultar
            </Button>
            <p className="text-xs text-muted-foreground sm:ml-auto">
              Consumo real facturado (RIPS) — rango máximo de {MAX_DIAS_RANGO_CONSUMO} días (~1 año) por el tamaño de las tablas RIPS.
            </p>
          </div>
          {!validacionRango.valido && (
            <p className="text-xs font-medium text-red-600">{validacionRango.error}</p>
          )}
        </CardContent>
      </Card>

      {codigoPrestadorSeleccionado && (cargandoContratos || contratosPrestador.length > 0) && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Consumo por contrato de este prestador</p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={desglosarPorContrato}
                  disabled={contratosSeleccionados.size === 0 || !validacionRango.valido || cargandoPorContrato}
                >
                  Desglosar por contrato
                </Button>
                {resultadosPorContrato && (
                  <Button size="sm" variant="outline" onClick={exportarResumenContratoCsv}>
                    <FileDown className="h-4 w-4" /> CSV resumen
                  </Button>
                )}
              </div>
            </div>
            {cargandoContratos ? (
              <p className="text-xs text-muted-foreground">Cargando contratos de este prestador…</p>
            ) : (
            <div className="flex flex-wrap gap-2">
              {contratosPrestador.map((c) => {
                const seleccionado = contratosSeleccionados.has(c.numeroContrato);
                return (
                  <button
                    key={c.numeroContrato}
                    type="button"
                    onClick={() => alternarContrato(c.numeroContrato)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      seleccionado ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted"
                    }`}
                  >
                    {c.numeroContrato} · {formatearFecha(c.fechaInicio)}–{formatearFecha(c.fechaTerminacion)}
                  </button>
                );
              })}
            </div>
            )}
            <p className="text-xs text-muted-foreground">
              El consumo de cada contrato se filtra de forma EXACTA por el número de contrato registrado en la factura
              (`rips_af.numero_contrato`), sobre el mismo período elegido arriba — útil para comparar un contrato original
              contra un otrosí/ampliación posterior. Cobertura real verificada: ~87–94% de las facturas desde 2022 tienen
              contrato registrado; el resto (facturas sin ese dato, más frecuentes en años anteriores a 2022) no aparecerá
              en ningún desglose por contrato aunque sí cuente en el consumo total del prestador arriba.
            </p>
          </CardContent>
        </Card>
      )}

      {resultadosPorContrato && (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Vigencia del contrato</TableHead>
                    <TableHead className="text-right">Facturas</TableHead>
                    <TableHead className="text-right">Códigos</TableHead>
                    <TableHead className="text-right">Valor total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultadosPorContrato.map((r) => (
                    <TableRow key={r.contrato.numeroContrato}>
                      <TableCell className="font-medium">{r.contrato.numeroContrato}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatearFecha(r.contrato.fechaInicio)} — {formatearFecha(r.contrato.fechaTerminacion)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.cargando ? "…" : r.resultado?.kpis.cantidadFacturas.toLocaleString("es-CO") ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">{r.resultado?.kpis.cantidadCodigosDistintos.toLocaleString("es-CO") ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {r.resultado ? formatearMoneda(r.resultado.kpis.valorTotalFacturado) : r.error ? r.error : "$ 0"}
                      </TableCell>
                      <TableCell>
                        {r.resultado && r.resultado.filas.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setContratoEnDetalle((actual) => (actual === r.contrato.numeroContrato ? null : r.contrato.numeroContrato))}
                          >
                            {contratoEnDetalle === r.contrato.numeroContrato ? "Ocultar detalle" : "Ver detalle"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {contratoEnDetalle && (
              <div className="mt-4 max-h-[50vh] overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Valor total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultadosPorContrato
                      .find((r) => r.contrato.numeroContrato === contratoEnDetalle)
                      ?.resultado?.filas.map((fila) => (
                        <TableRow key={`${fila.tipo}-${fila.codigoTarifa}`}>
                          <TableCell className="font-mono text-xs">{fila.codigoTarifa}</TableCell>
                          <TableCell className="max-w-[360px] truncate" title={fila.descripcion}>
                            {fila.descripcion}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{ETIQUETAS_TIPO[fila.tipo]}</TableCell>
                          <TableCell className="text-right">{fila.cantidad.toLocaleString("es-CO")}</TableCell>
                          <TableCell className="text-right font-semibold">{formatearMoneda(fila.valorTotal)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {consultado && (
        <>
          {cargandoResultado ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Consultando RIPS del {formatearFecha(fechaInicio)} al {formatearFecha(fechaFin)}… puede tardar varios segundos (tablas de cientos de millones de filas, sin índice por fecha).
              </CardContent>
            </Card>
          ) : errorConsulta ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-red-600">{errorConsulta}</CardContent>
            </Card>
          ) : resultado && resultado.filas.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Sin consumo facturado para {resultado.razonSocial} del {formatearFecha(resultado.fechaInicio)} al {formatearFecha(resultado.fechaFin)}.
              </CardContent>
            </Card>
          ) : resultado ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <TarjetaKpi etiqueta="Valor total facturado" valor={formatearMoneda(resultado.kpis.valorTotalFacturado)} />
                <TarjetaKpi etiqueta="Facturas del período" valor={resultado.kpis.cantidadFacturas.toLocaleString("es-CO")} />
                <TarjetaKpi etiqueta="Códigos distintos" valor={resultado.kpis.cantidadCodigosDistintos.toLocaleString("es-CO")} />
                <TarjetaKpi
                  etiqueta="Procedimientos / Medicamentos"
                  valor={`${resultado.kpis.cantidadServicios.toLocaleString("es-CO")} / ${resultado.kpis.cantidadMedicamentos.toLocaleString("es-CO")}`}
                />
                <TarjetaKpi etiqueta="Insumos" valor={resultado.kpis.cantidadInsumos.toLocaleString("es-CO")} />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Select
                  value={filtroTipo}
                  onChange={(e) => {
                    setFiltroTipo(e.target.value as "todos" | TipoConsumo);
                    setPagina(1);
                  }}
                  className="w-56"
                >
                  <option value="todos">Todos los tipos</option>
                  <option value="servicios">Procedimientos (CUPS)</option>
                  <option value="medicamentos">Medicamentos (CUM)</option>
                  <option value="insumos">Insumos</option>
                </Select>
                <div className="flex items-center gap-2">
                  <ArrowDownUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Select
                    value={orden}
                    onChange={(e) => {
                      setOrden(e.target.value as typeof orden);
                      setPagina(1);
                    }}
                    className="w-60"
                  >
                    <option value="valor_desc">Valor: mayor a menor</option>
                    <option value="valor_asc">Valor: menor a mayor</option>
                    <option value="cantidad_desc">Cantidad: mayor a menor</option>
                    <option value="cantidad_asc">Cantidad: menor a mayor</option>
                  </Select>
                </div>
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
                      <TableHead>Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Valor total</TableHead>
                      <TableHead className="text-right">Valor promedio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filasPagina.map((fila) => (
                      <TableRow key={`${fila.tipo}-${fila.codigoTarifa}`}>
                        <TableCell className="font-mono text-xs">{fila.codigoTarifa}</TableCell>
                        <TableCell className="max-w-[360px] truncate" title={fila.descripcion}>
                          {fila.descripcion}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{ETIQUETAS_TIPO[fila.tipo]}</TableCell>
                        <TableCell className="text-right">{fila.cantidad.toLocaleString("es-CO")}</TableCell>
                        <TableCell className="text-right font-semibold">{formatearMoneda(fila.valorTotal)}</TableCell>
                        <TableCell className="text-right">{formatearMoneda(fila.valorPromedio)}</TableCell>
                      </TableRow>
                    ))}
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
          ) : null}
        </>
      )}
    </div>
  );
}
