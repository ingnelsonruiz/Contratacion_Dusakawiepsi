"use client";

/**
 * "Perfil Competitivo del Prestador" — tarjeta nueva e independiente del
 * dashboard (pedida por el usuario 2026-07-29: "necesito una tarjeta
 * aparte... que analice un prestador en sí contra prestadores del mismo
 * municipio"). Complementa a "Comparativo Histórico del Prestador" (Módulo 3,
 * dimensión temporal) con la dimensión de PARES (mismo municipio, hoy).
 *
 * Reutiliza infraestructura ya construida: `getOpcionesPrestadoresRiesgo` y el
 * mismo patrón de barra de progreso simulada del Dashboard Analítico de
 * Riesgo (dashboard-riesgo-tab.tsx) — la consulta de fondo es la misma
 * (recorre TODO el tarifario de un tipo a través de todos los municipios), así
 * que el tiempo de espera es comparable.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Search from "lucide-react/icons/search";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import FileDown from "lucide-react/icons/file-down";
import Trophy from "lucide-react/icons/trophy";
import MapPin from "lucide-react/icons/map-pin";
import Info from "lucide-react/icons/info";
import ChevronDown from "lucide-react/icons/chevron-down";
import ChevronRight from "lucide-react/icons/chevron-right";
import X from "lucide-react/icons/x";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { colorSemaforo } from "@/components/comparativo/semaforo-ui";
import { formatearMoneda, formatearPorcentaje } from "@/lib/negociacion/formato";
import { etiquetaNivelSemaforo } from "@/lib/negociacion/comparativo";
import { etiquetaNivelRiesgo } from "@/lib/negociacion/dashboard-riesgo";
import { getOpcionesPrestadoresRiesgo } from "@/app/actions/dashboard-riesgo-actions";
import { getPerfilPrestador } from "@/app/actions/perfil-prestador-actions";
import type { TipoComparativo, ReferenciaVariacion, UmbralesSemaforo, NivelSemaforo } from "@/types/comparativo";
import { UMBRALES_SEMAFORO_DEFECTO } from "@/types/comparativo";
import type { ResultadoPerfilPrestador, FilaCodigoPerfil } from "@/types/perfil-prestador";
import type { FilaRankingRiesgo } from "@/types/dashboard-riesgo";

const PAGE_SIZE = 100;

const ETIQUETAS_TIPO: Record<TipoComparativo, string> = {
  servicios: "Procedimientos (CUPS)",
  medicamentos: "Medicamentos (CUM)",
  insumos: "Insumos",
};

const MENSAJES_CARGA = [
  "Consultando tarifario vigente del prestador y sus pares…",
  "Cruzando precios dentro de cada municipio…",
  "Calculando semáforo y score de riesgo…",
  "Armando el detalle código por código…",
];

/** Barra de progreso simulada — mismo criterio y motivo que BarraProgresoCarga en dashboard-riesgo-tab.tsx (una sola consulta al proxy, sin pasos reales medibles). */
function BarraProgresoCarga({ progreso, mensaje }: { progreso: number; mensaje: string }) {
  return (
    <div className="mx-auto max-w-md space-y-3 py-6 text-center">
      <p className="text-sm font-medium">Calculando perfil del prestador…</p>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
          style={{ width: `${Math.round(progreso)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{Math.round(progreso)}%</p>
      <p className="text-xs text-muted-foreground">{mensaje}</p>
    </div>
  );
}

/**
 * Ícono "i" con tooltip nativo (`title`) — pedido explícito del usuario
 * 2026-07-29: "que tenga un tooltip que me diga para qué sirve" (a
 * diferencia del menú emergente de doble clic ya usado en Amplitud/KPIs del
 * Dashboard de Riesgo, aquí se pidió tooltip simple, sin dependencia nueva).
 */
function InfoTooltip({ texto }: { texto: string }) {
  return (
    <span title={texto} className="ml-1 inline-flex cursor-help align-middle text-muted-foreground">
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}

/** Overlay genérico de doble clic — mismo patrón ya usado en dashboard-riesgo-tab.tsx (ModalInfo): sin librería de diálogo, position fixed + fondo oscuro + Card centrada. */
function ModalOverlay({ titulo, subtitulo, onClose, children }: { titulo: string; subtitulo?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="max-h-[85vh] w-full max-w-4xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <CardContent className="flex max-h-[85vh] flex-col gap-3 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">{titulo}</p>
              {subtitulo ? <p className="text-xs text-muted-foreground">{subtitulo}</p> : null}
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="overflow-y-auto">{children}</div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Tabla del ranking completo — se abre con doble clic sobre "Posición en el ranking". Resalta la fila del prestador analizado. */
function TablaRankingCompleto({ ranking, ipsActual }: { ranking: FilaRankingRiesgo[]; ipsActual: number }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Prestador</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead className="text-right">% Crítico</TableHead>
          <TableHead className="text-right">Costo potencial adicional</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ranking.map((r, i) => (
          <TableRow key={r.ips} className={r.ips === ipsActual ? "bg-primary/10 font-medium" : undefined}>
            <TableCell>{i + 1}</TableCell>
            <TableCell className="max-w-[280px] truncate" title={r.razonSocial}>
              {r.razonSocial}
              {r.ips === ipsActual ? <span className="ml-1 text-[10px] text-primary">(este prestador)</span> : null}
            </TableCell>
            <TableCell className="text-right">{r.score} / 100</TableCell>
            <TableCell className="text-right">{r.pctCritico.toFixed(0)}%</TableCell>
            <TableCell className="text-right">{formatearMoneda(r.costoPotencialAdicional)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

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
  tono?: "rojo" | "ambar" | "azul" | "neutro";
  onClick?: () => void;
  activo?: boolean;
}) {
  const colorValor =
    tono === "rojo" ? "text-red-600" : tono === "ambar" ? "text-amber-600" : tono === "azul" ? "text-sky-600" : "text-foreground";
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

export function PerfilPrestadorClient() {
  const [tipo, setTipo] = useState<TipoComparativo>("servicios");
  const [prestadores, setPrestadores] = useState<{ ips: number; razonSocial: string; nit: string }[]>([]);
  const [cargandoPrestadores, setCargandoPrestadores] = useState(true);
  const [busquedaPrestador, setBusquedaPrestador] = useState("");
  const [ipsSeleccionado, setIpsSeleccionado] = useState<string>("");

  const [referencia, setReferencia] = useState<ReferenciaVariacion>("promedio");
  const [umbrales, setUmbrales] = useState<UmbralesSemaforo>(UMBRALES_SEMAFORO_DEFECTO);

  const [resultado, setResultado] = useState<ResultadoPerfilPrestador | null>(null);
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [mensajeIdx, setMensajeIdx] = useState(0);

  const [filtroNivel, setFiltroNivel] = useState<NivelSemaforo | "todos">("todos");
  const [pagina, setPagina] = useState(1);
  // Doble clic en "Posición en el ranking" → modal con el ranking completo —
  // pedido del usuario 2026-07-29.
  const [mostrarRanking, setMostrarRanking] = useState(false);

  // Opciones de prestador — dependen del tipo de tarifario (un prestador puede
  // no tener contrato de, por ejemplo, medicamentos). Se recargan al cambiar tipo.
  useEffect(() => {
    setCargandoPrestadores(true);
    setIpsSeleccionado("");
    setResultado(null);
    getOpcionesPrestadoresRiesgo(tipo)
      .then(setPrestadores)
      .finally(() => setCargandoPrestadores(false));
  }, [tipo]);

  const prestadoresFiltrados = useMemo(() => {
    const q = busquedaPrestador.trim().toLowerCase();
    if (!q) return prestadores;
    return prestadores.filter((p) => p.razonSocial.toLowerCase().includes(q) || p.nit.includes(q));
  }, [prestadores, busquedaPrestador]);

  async function consultar(ips: string) {
    if (!ips) return;
    setCargando(true);
    setProgreso(0);
    setFiltroNivel("todos");
    setPagina(1);
    try {
      const res = await getPerfilPrestador(Number(ips), tipo, referencia, umbrales);
      setResultado(res);
    } finally {
      setProgreso(100);
      setCargando(false);
    }
  }

  // Recalcula con los umbrales/referencia actuales sin que el usuario tenga
  // que volver a pulsar "Consultar" — mismo criterio que Módulo 3.
  useEffect(() => {
    if (ipsSeleccionado) consultar(ipsSeleccionado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [umbrales, referencia]);

  useEffect(() => {
    if (!cargando) return;
    const intervalo = setInterval(() => {
      setProgreso((actual) => {
        if (actual >= 92) return actual;
        const incremento = Math.max(0.4, (92 - actual) * 0.06);
        return Math.min(92, actual + incremento);
      });
    }, 200);
    return () => clearInterval(intervalo);
  }, [cargando]);

  useEffect(() => {
    if (!cargando) {
      setMensajeIdx(0);
      return;
    }
    const intervalo = setInterval(() => setMensajeIdx((i) => (i + 1) % MENSAJES_CARGA.length), 2200);
    return () => clearInterval(intervalo);
  }, [cargando]);

  const codigosFiltrados = useMemo(() => {
    if (!resultado) return [];
    if (filtroNivel === "todos") return resultado.codigos;
    return resultado.codigos.filter((c) => c.nivel === filtroNivel);
  }, [resultado, filtroNivel]);

  function alternarNivel(nivel: NivelSemaforo) {
    setFiltroNivel((actual) => (actual === nivel ? "todos" : nivel));
    setPagina(1);
  }

  const totalPaginas = Math.max(1, Math.ceil(codigosFiltrados.length / PAGE_SIZE));
  const codigosPagina = codigosFiltrados.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  function urlExport(formato: "xlsx" | "csv"): string {
    const params = new URLSearchParams({
      ips: ipsSeleccionado,
      tipo,
      referencia,
      alertaPct: String(umbrales.alertaPct),
      criticoPct: String(umbrales.criticoPct),
      formato,
    });
    if (filtroNivel !== "todos") params.set("nivel", filtroNivel);
    return `/api/export/perfil-prestador?${params.toString()}`;
  }

  const resumen = resultado?.resumen ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:flex-wrap">
          <Select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoComparativo)}
            className="w-56"
          >
            {(Object.keys(ETIQUETAS_TIPO) as TipoComparativo[]).map((t) => (
              <option key={t} value={t}>
                {ETIQUETAS_TIPO[t]}
              </option>
            ))}
          </Select>
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
            value={ipsSeleccionado}
            onChange={(e) => setIpsSeleccionado(e.target.value)}
            className="w-80"
            disabled={cargandoPrestadores || prestadoresFiltrados.length === 0}
          >
            <option value="">{cargandoPrestadores ? "Cargando prestadores…" : "Seleccione un prestador…"}</option>
            {prestadoresFiltrados.map((p) => (
              <option key={p.ips} value={p.ips}>
                {p.razonSocial} — NIT {p.nit}
              </option>
            ))}
          </Select>
          <Button onClick={() => consultar(ipsSeleccionado)} disabled={!ipsSeleccionado || cargando}>
            Consultar
          </Button>
          <p className="text-xs text-muted-foreground sm:ml-auto">
            {prestadores.length.toLocaleString("es-CO")} prestadores con tarifario vigente de {ETIQUETAS_TIPO[tipo].toLowerCase()}.
          </p>
        </CardContent>
      </Card>

      {ipsSeleccionado && (
        <Card className="print:hidden">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end sm:gap-6">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Comparar contra</label>
              <Select value={referencia} onChange={(e) => setReferencia(e.target.value as ReferenciaVariacion)} className="w-36">
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
              Cada código se compara contra el {referencia === "promedio" ? "promedio" : "la mediana"} de TODOS los prestadores de ese
              código en el mismo municipio (incluyendo a este prestador).
            </p>
          </CardContent>
        </Card>
      )}

      {cargando && !resultado ? (
        <Card>
          <CardContent>
            <BarraProgresoCarga progreso={progreso} mensaje={MENSAJES_CARGA[mensajeIdx]} />
          </CardContent>
        </Card>
      ) : resultado ? (
        !resumen ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {resultado.razonSocial} no tiene códigos con 2 o más prestadores en el mismo municipio para{" "}
              {ETIQUETAS_TIPO[tipo].toLowerCase()} — sin comparación real posible (posible único contratista en sus municipios para
              este tipo de tarifario).
            </CardContent>
          </Card>
        ) : (
          <>
            {/* --- Resumen ejecutivo --- */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-6">
                  <p className="flex items-center text-xs font-medium text-muted-foreground">
                    Score de riesgo
                    <InfoTooltip texto="Indicador heurístico 0-100 que resume qué tan riesgoso es negociar con este prestador: combina % de tarifas críticas (peso 40%), % en alerta (20%), desviación promedio (25%) y amplitud del mercado (15%). No es un modelo estadístico validado, es una priorización para auditoría." />
                  </p>
                  <p className="mt-1 text-xl font-bold">{resumen.score} / 100</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{etiquetaNivelRiesgo(resumen.nivelRiesgo)}</p>
                </CardContent>
              </Card>
              <Card
                onDoubleClick={() => setMostrarRanking(true)}
                className="cursor-pointer transition-colors hover:border-primary"
                title="Doble clic para ver el ranking completo de prestadores"
              >
                <CardContent className="pt-6">
                  <p className="flex items-center text-xs font-medium text-muted-foreground">
                    <Trophy className="mr-1 inline h-3.5 w-3.5" /> Posición en el ranking
                    <InfoTooltip texto="Posición de este prestador frente a TODOS los demás del mismo tipo de tarifario, ordenados de mayor a menor costo potencial adicional (el que más sobrecosto genera queda de primero). Doble clic para ver el ranking completo." />
                  </p>
                  <p className="mt-1 text-xl font-bold">
                    {resultado.posicionRanking} de {resultado.totalPrestadoresRanking}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-primary">Doble clic para ver el ranking completo</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs font-medium text-muted-foreground">Costo potencial adicional</p>
                  <p className="mt-1 text-xl font-bold text-red-600">{formatearMoneda(resumen.costoPotencialAdicional)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Suma de sobrecostos en códigos crítico/alerta</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs font-medium text-muted-foreground">
                    <MapPin className="mr-1 inline h-3.5 w-3.5" /> Municipios donde opera
                  </p>
                  <p className="mt-1 text-xl font-bold">{resumen.municipiosDondeOpera.length}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={resumen.municipiosDondeOpera.join(", ")}>
                    {resumen.municipiosDondeOpera.join(", ")}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* --- Segmentadores por nivel — clic filtra la tabla de abajo --- */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <TarjetaKpi
                etiqueta="Críticas"
                valor={resumen.cantidadCritico.toLocaleString("es-CO")}
                sub={`${resumen.pctCritico.toFixed(0)}% del total`}
                tono="rojo"
                onClick={() => alternarNivel("critico")}
                activo={filtroNivel === "critico"}
              />
              <TarjetaKpi
                etiqueta="Alerta"
                valor={resumen.cantidadAlerta.toLocaleString("es-CO")}
                sub={`${resumen.pctAlerta.toFixed(0)}% del total`}
                tono="ambar"
                onClick={() => alternarNivel("alerta")}
                activo={filtroNivel === "alerta"}
              />
              <TarjetaKpi
                etiqueta="OK"
                valor={resumen.cantidadOk.toLocaleString("es-CO")}
                onClick={() => alternarNivel("ok")}
                activo={filtroNivel === "ok"}
              />
              <TarjetaKpi
                etiqueta="Favorables"
                valor={resumen.cantidadFavorable.toLocaleString("es-CO")}
                tono="azul"
                onClick={() => alternarNivel("favorable")}
                activo={filtroNivel === "favorable"}
              />
              <TarjetaKpi
                etiqueta="Muy favorables"
                valor={resumen.cantidadMuyFavorable.toLocaleString("es-CO")}
                tono="azul"
                onClick={() => alternarNivel("muyFavorable")}
                activo={filtroNivel === "muyFavorable"}
              />
            </div>

            {/* --- Tabla código por código --- */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="text-sm font-medium">Detalle código por código</p>
              <div className="flex items-center gap-2 sm:ml-auto">
                <Badge>{codigosFiltrados.length.toLocaleString("es-CO")} códigos</Badge>
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
                    <TableHead className="min-w-[260px]">Descripción</TableHead>
                    <TableHead>Municipio</TableHead>
                    <TableHead className="text-right">Valor del prestador</TableHead>
                    <TableHead className="text-right">Mín / Máx del grupo</TableHead>
                    <TableHead className="text-right">{referencia === "promedio" ? "Promedio" : "Mediana"} del grupo</TableHead>
                    <TableHead className="text-right">Variación %</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codigosPagina.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                        Sin códigos para los criterios actuales.
                      </TableCell>
                    </TableRow>
                  ) : (
                    codigosPagina.map((c) => <FilaCodigoPerfilRow key={`${c.codigoTarifa}__${c.municipioNombre}`} fila={c} />)
                  )}
                </TableBody>
              </Table>
            </div>

            <Paginacion
              page={pagina}
              totalPaginas={totalPaginas}
              total={codigosFiltrados.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPagina}
            />
          </>
        )
      ) : null}

      {mostrarRanking && resultado && (
        <ModalOverlay
          titulo="Ranking completo de prestadores"
          subtitulo={`${ETIQUETAS_TIPO[tipo]} · ordenado por costo potencial adicional (mayor a menor)`}
          onClose={() => setMostrarRanking(false)}
        >
          <TablaRankingCompleto ranking={resultado.rankingCompleto} ipsActual={resultado.ips} />
        </ModalOverlay>
      )}
    </div>
  );
}

/**
 * Fila-acordeón: clic en cualquier parte expande/colapsa una segunda fila
 * con la lista completa de prestadores del grupo (código+municipio) — pedido
 * del usuario 2026-07-29: "coloca un acordeón en cada código para ver los
 * otros prestadores con los que se compara cada código". Mismo patrón que
 * FilaHistoricoExpandible en historico-prestador-client.tsx.
 */
function FilaCodigoPerfilRow({ fila }: { fila: FilaCodigoPerfil }) {
  const [abierto, setAbierto] = useState(false);

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
        {/* Descripción sin truncar — antes se cortaba con "…" en 260px; ahora
            envuelve en varias líneas dentro de una columna más ancha, para
            que se lea completa sin depender del tooltip nativo. */}
        <TableCell className="min-w-[260px] max-w-[420px] whitespace-normal break-words">{fila.descripcion}</TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {fila.municipioNombre}
          <div className="text-[10px]">{fila.cantidadPrestadoresGrupo} prestadores</div>
        </TableCell>
        <TableCell className="text-right font-medium">
          {formatearMoneda(fila.valorPrestador)}
          {/* Número de contrato del propio prestador — pedido 2026-07-29:
              "para ubicar rápidamente su número de contrato", mismo criterio
              ya usado en Módulo 2/3 (valor + contrato apilados). */}
          {fila.numeroContratoPrestador ? (
            <div className="font-mono text-[10px] font-normal text-muted-foreground">{fila.numeroContratoPrestador}</div>
          ) : null}
        </TableCell>
        <TableCell className="text-right text-xs text-muted-foreground">
          {formatearMoneda(fila.minimo)} / {formatearMoneda(fila.maximo)}
        </TableCell>
        <TableCell className="text-right">{formatearMoneda(fila.valorReferencia)}</TableCell>
        <TableCell className="text-right">
          <span className={`font-semibold ${fila.variacionPct > 0 ? "text-red-600" : fila.variacionPct < 0 ? "text-sky-600" : ""}`}>
            {fila.variacionPct > 0 ? "+" : ""}
            {formatearPorcentaje(fila.variacionPct)}
          </span>
        </TableCell>
        <TableCell className="text-center">
          <Badge className={colorSemaforo(fila.nivel)}>{etiquetaNivelSemaforo(fila.nivel)}</Badge>
        </TableCell>
      </TableRow>
      {abierto && (
        <TableRow className="border-l-4 border-l-primary bg-primary/5">
          <TableCell colSpan={9} className="p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Los {fila.prestadoresGrupo.length} prestadores de este código en {fila.municipioNombre} (ordenados de menor a mayor valor) —
              con su número de contrato para ubicarlo rápidamente en ARYUWIS:
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {fila.prestadoresGrupo.map((p) => (
                <div
                  key={p.ips}
                  className={`rounded-md border p-2 text-xs ${p.esEstePrestador ? "border-primary bg-primary/10" : "bg-background"}`}
                >
                  <p className="truncate font-medium" title={p.razonSocial}>
                    {p.razonSocial} {p.esEstePrestador ? "(este prestador)" : ""}
                  </p>
                  <p className="text-muted-foreground">NIT {p.nit}</p>
                  <p className="mt-0.5 font-semibold">{formatearMoneda(p.valorFinal)}</p>
                  <p className="font-mono text-muted-foreground">Contrato: {p.numeroContrato}</p>
                </div>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
