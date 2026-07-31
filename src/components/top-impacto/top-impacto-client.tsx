"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import FileDown from "lucide-react/icons/file-down";
import ArrowDownUp from "lucide-react/icons/arrow-down-up";
import Trophy from "lucide-react/icons/trophy";
import Coins from "lucide-react/icons/coins";
import ListChecks from "lucide-react/icons/list-checks";
import Hash from "lucide-react/icons/hash";
import X from "lucide-react/icons/x";
import Loader2 from "lucide-react/icons/loader-2";
import AlertTriangle from "lucide-react/icons/alert-triangle";

import Search from "lucide-react/icons/search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Paginacion } from "@/components/tarifarios/paginacion";
import { formatearMoneda, formatearPorcentaje, formatearFecha } from "@/lib/negociacion/formato";
import { ETIQUETAS_TIPO_IMPACTO } from "@/lib/negociacion/top-impacto";
import {
  getOpcionesFiltrosImpacto,
  getTopImpacto,
  getContratosPrestador,
  getFacturasCodigoImpacto,
} from "@/app/actions/top-impacto-actions";
import type {
  TipoImpacto,
  OpcionesFiltrosImpacto,
  OpcionContratoPrestador,
  ResultadoTopImpacto,
  FilaTopImpacto,
  FilaImpactoPrestador,
  FilaImpactoMunicipio,
  ResultadoFacturasImpacto,
} from "@/types/top-impacto";

const PAGE_SIZE = 25;

// Fix 2026-07-31: aviso de seguridad en el cliente. Si `getTopImpacto()`
// nunca resuelve ni rechaza (función serverless matada por la plataforma
// antes de que el proxy de BD responda — ver KnowledgeBase/09-Errores/
// Problemas Comunes.md #5), esta espera libera la UI igual con un mensaje
// accionable en vez de dejar la barra congelada para siempre. Por encima de
// PROXY_TIMEOUT_MS (90s, src/lib/db.ts) para no cortar consultas que sí
// están progresando normalmente dentro de ese margen.
const TIMEOUT_AVISO_CONSULTA_MS = 100_000;

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
 *
 * `onDoubleClickItem` (opcional, pedido del usuario 2026-07-30 — drill-down
 * "de lo general a lo particular"): si se pasa, cada barra se vuelve
 * clickeable (doble clic) y reporta el índice dentro de `datos` para que el
 * llamador resuelva la fila original (`FilaImpactoPrestador`, etc.) — este
 * componente solo conoce `{etiqueta, valor}`, no el objeto de dominio.
 */
function GraficoBarras({
  titulo,
  datos,
  onDoubleClickItem,
}: {
  titulo: string;
  datos: { etiqueta: string; valor: number }[];
  onDoubleClickItem?: (indice: number) => void;
}) {
  const maximo = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="mb-3 text-sm font-semibold">{titulo}</p>
        {onDoubleClickItem ? (
          <p className="mb-2 text-[11px] text-muted-foreground">Doble clic sobre una barra para ver el detalle.</p>
        ) : null}
        {datos.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Sin datos para este filtro.</p>
        ) : (
          <div className="space-y-2">
            {datos.map((d, i) => (
              <div
                key={`${d.etiqueta}-${i}`}
                className={`text-xs ${onDoubleClickItem ? "cursor-pointer rounded-sm hover:bg-muted/60" : ""}`}
                onDoubleClick={onDoubleClickItem ? () => onDoubleClickItem(i) : undefined}
                title={onDoubleClickItem ? "Doble clic para ver el detalle" : undefined}
              >
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

/**
 * Overlay de doble clic — mismo patrón ya usado en `perfil-prestador-client.tsx`
 * y `dashboard-riesgo-tab.tsx` (sin librería de diálogo nueva, `createPortal`
 * a `document.body` para poder abrirse desde dentro de las barras/filas sin
 * quedar recortado por `overflow` ni romper el DOM si el disparador vive
 * dentro de una tabla).
 */
function ModalOverlay({
  titulo,
  subtitulo,
  onClose,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;

  return createPortal(
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
    </div>,
    document.body
  );
}

type ColumnaOrden = "valorTotal" | "cantidad" | "valorPromedio" | "prestadores" | "pctDelTotal";

export function TopImpactoClient() {
  const [opciones, setOpciones] = useState<OpcionesFiltrosImpacto | null>(null);
  const [cargandoOpciones, setCargandoOpciones] = useState(true);

  const [tipo, setTipo] = useState<TipoImpacto>("todos");
  const [anio, setAnio] = useState<number>(new Date().getFullYear());
  const [busquedaPrestador, setBusquedaPrestador] = useState("");
  const [ipsSeleccionado, setIpsSeleccionado] = useState<string>("");
  const [municipioCodigo, setMunicipioCodigo] = useState<string>("");
  const [numeroContrato, setNumeroContrato] = useState<string>("");

  // Cascada Prestador → Contrato(s) → Municipio (pedido 2026-07-30): al elegir
  // un prestador, se cargan SOLO sus contratos vigentes (en vez del listado
  // completo de ~280 contratos de la EPS) y se puede marcar uno, varios o
  // todos — el o los municipios de administración correspondientes se
  // muestran automáticamente, sin un selector aparte.
  const [contratosPrestador, setContratosPrestador] = useState<OpcionContratoPrestador[]>([]);
  const [cargandoContratosPrestador, setCargandoContratosPrestador] = useState(false);
  const [contratosSeleccionados, setContratosSeleccionados] = useState<Set<string>>(new Set());

  const prestadoresFiltrados = useMemo(() => {
    if (!opciones) return [];
    const q = busquedaPrestador.trim().toLowerCase();
    if (!q) return opciones.prestadores;
    return opciones.prestadores.filter((p) => p.razonSocial.toLowerCase().includes(q) || p.nit.includes(q));
  }, [opciones, busquedaPrestador]);

  useEffect(() => {
    if (!ipsSeleccionado) {
      setContratosPrestador([]);
      setContratosSeleccionados(new Set());
      return;
    }
    let cancelado = false;
    setCargandoContratosPrestador(true);
    getContratosPrestador(Number(ipsSeleccionado))
      .then((contratos) => {
        if (cancelado) return;
        setContratosPrestador(contratos);
        // Por defecto, todos los contratos del prestador quedan marcados —
        // equivale a "sin sub-filtro adicional", el mismo resultado que ya
        // trae filtrar solo por `ips`.
        setContratosSeleccionados(new Set(contratos.map((c) => c.numeroContrato)));
      })
      .finally(() => {
        if (!cancelado) setCargandoContratosPrestador(false);
      });
    return () => {
      cancelado = true;
    };
  }, [ipsSeleccionado]);

  function alternarContrato(numero: string) {
    setContratosSeleccionados((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(numero)) nuevo.delete(numero);
      else nuevo.add(numero);
      return nuevo;
    });
  }

  const municipiosDelPrestador = useMemo(() => {
    const nombres = new Set(
      contratosPrestador.filter((c) => contratosSeleccionados.has(c.numeroContrato)).map((c) => c.municipioNombre)
    );
    return Array.from(nombres);
  }, [contratosPrestador, contratosSeleccionados]);

  const [resultado, setResultado] = useState<ResultadoTopImpacto | null>(null);
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [mensajeIdx, setMensajeIdx] = useState(0);
  // Fix 2026-07-31 (reporte del usuario: "se quedo aca no avanza"): antes,
  // `consultar()` solo tenía try/finally, así que si la consulta pesada
  // (tipo="todos" + municipio, sin prestador que acote) tardaba más de lo
  // que tolera la función serverless — ver KnowledgeBase/09-Errores/Problemas
  // Comunes.md #5 — la barra se quedaba congelada en 92% para siempre, sin
  // ningún mensaje. `errorConsulta` + el timeout de aviso de abajo le dan al
  // usuario una salida clara en vez de una pantalla muerta.
  const [errorConsulta, setErrorConsulta] = useState<string | null>(null);

  // Drill-down "de lo general a lo particular" (pedido 2026-07-30): Nivel 2
  // (prestador → códigos) y Nivel 3 (código → facturas) — ver comentario
  // completo en ResultadoTopImpacto/ResultadoFacturasImpacto, types/top-impacto.ts.
  const [drillPrestador, setDrillPrestador] = useState<FilaImpactoPrestador | null>(null);
  const [drillNivel2, setDrillNivel2] = useState<ResultadoTopImpacto | null>(null);
  const [cargandoDrillNivel2, setCargandoDrillNivel2] = useState(false);

  const [drillCodigo, setDrillCodigo] = useState<FilaTopImpacto | null>(null);
  const [drillNivel3, setDrillNivel3] = useState<ResultadoFacturasImpacto | null>(null);
  const [cargandoDrillNivel3, setCargandoDrillNivel3] = useState(false);

  /**
   * Nivel 2: se llama de nuevo a `getTopImpacto`, pero con los MISMOS
   * filtros ya usados para calcular la barra (`resultado.filtros`, no el
   * estado vivo de los selectores — que pudo cambiar después de consultar),
   * sobrescribiendo solo `ips` con el prestador de la barra elegida. Así el
   * total del desglose siempre coincide con el valor exacto de la barra.
   */
  async function abrirDrillPrestador(p: FilaImpactoPrestador) {
    if (!resultado) return;
    setDrillPrestador(p);
    setDrillNivel2(null);
    setDrillCodigo(null);
    setDrillNivel3(null);
    // "Código no registrado: <codigo>" (ver FilaImpactoPrestador.ips) — sin
    // fila en ct_ips, no hay `ips` con el cual volver a filtrar. Se muestra
    // igual el modal, con un mensaje explicando por qué no se puede
    // profundizar (mismo criterio de honestidad ya documentado en
    // `obtenerPorPrestador`: no ocultar el caso, explicarlo).
    if (p.ips === null) return;
    setCargandoDrillNivel2(true);
    try {
      const res = await getTopImpacto({ ...resultado.filtros, ips: p.ips });
      setDrillNivel2(res);
    } finally {
      setCargandoDrillNivel2(false);
    }
  }

  function cerrarDrillPrestador() {
    setDrillPrestador(null);
    setDrillNivel2(null);
    setDrillCodigo(null);
    setDrillNivel3(null);
  }

  /** Nivel 3: reutiliza los mismos filtros del Nivel 2 (año/municipio/contrato ya acotados), fijando `ips` + el código/tipo de la fila elegida. */
  async function abrirDrillCodigo(fila: FilaTopImpacto) {
    if (!drillPrestador || drillPrestador.ips === null || !drillNivel2) return;
    setDrillCodigo(fila);
    setDrillNivel3(null);
    setCargandoDrillNivel3(true);
    try {
      const res = await getFacturasCodigoImpacto({ ...drillNivel2.filtros, ips: drillPrestador.ips }, fila.tipo, fila.codigo);
      setDrillNivel3(res);
    } finally {
      setCargandoDrillNivel3(false);
    }
  }

  function cerrarDrillCodigo() {
    setDrillCodigo(null);
    setDrillNivel3(null);
  }

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

  /**
   * Lista efectiva de contratos a enviar al servidor. Con prestador elegido,
   * son los contratos marcados en la cascada (por defecto, todos los suyos —
   * ver nota en `FiltrosImpacto.numerosContrato` sobre por qué esto no
   * cambia el valor radicado del prestador, solo acota qué municipio(s) de
   * administración se muestran). Sin prestador elegido, es el selector
   * EPS-completo de un solo contrato (comportamiento previo, sin cambios).
   */
  function numerosContratoEfectivos(): string[] | null {
    if (ipsSeleccionado) {
      return contratosSeleccionados.size > 0 ? Array.from(contratosSeleccionados) : null;
    }
    return numeroContrato ? [numeroContrato] : null;
  }

  async function consultar() {
    setCargando(true);
    setProgreso(0);
    setPagina(1);
    setErrorConsulta(null);
    // Timer del aviso de seguridad — se cancela en el `finally` si la
    // consulta real ya resolvió (éxito o error) antes de tiempo. Si nunca
    // se cancela, es la señal misma de que la función quedó colgada.
    let avisoDisparado = false;
    const idAviso = setTimeout(() => {
      avisoDisparado = true;
      setErrorConsulta(
        "La consulta está tardando más de lo esperado y puede haberse quedado sin respuesta del servidor. " +
          "Esto suele pasar con filtros muy amplios (tipo \"Todos\" + un municipio, sin prestador). " +
          "Sugerencia: elige un tipo específico (servicios, consultas, medicamentos o insumos) o un prestador puntual, y vuelve a consultar."
      );
      setCargando(false);
    }, TIMEOUT_AVISO_CONSULTA_MS);

    try {
      const res = await getTopImpacto({
        tipo,
        anio,
        ips: ipsSeleccionado ? Number(ipsSeleccionado) : null,
        municipioCodigo: ipsSeleccionado ? null : municipioCodigo || null,
        numerosContrato: numerosContratoEfectivos(),
      });
      if (avisoDisparado) return; // ya se le avisó al usuario y se soltó la UI; no pisar ese estado con datos tardíos.
      setResultado(res);
    } catch (e) {
      if (avisoDisparado) return;
      setErrorConsulta(
        e instanceof Error
          ? `No se pudo completar la consulta: ${e.message}`
          : "No se pudo completar la consulta por un error inesperado. Intenta de nuevo o acota los filtros."
      );
    } finally {
      clearTimeout(idAviso);
      if (!avisoDisparado) {
        setProgreso(100);
        setCargando(false);
      }
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
    if (!ipsSeleccionado && municipioCodigo) params.set("municipioCodigo", municipioCodigo);
    const contratos = numerosContratoEfectivos();
    if (contratos && contratos.length > 0) params.set("numerosContrato", contratos.join(","));
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
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busquedaPrestador}
                onChange={(e) => setBusquedaPrestador(e.target.value)}
                placeholder="Buscar prestador por nombre o NIT…"
                className="pl-8"
                disabled={cargandoOpciones}
              />
            </div>
            <Select
              value={ipsSeleccionado}
              onChange={(e) => {
                setIpsSeleccionado(e.target.value);
                // Los filtros EPS-completos de municipio/contrato solo aplican
                // sin prestador elegido — se limpian al elegir uno para no
                // dejar un filtro invisible activo de la vista anterior.
                setMunicipioCodigo("");
                setNumeroContrato("");
              }}
              className="w-72"
              disabled={cargandoOpciones}
            >
              <option value="">Todos los prestadores</option>
              {prestadoresFiltrados.map((p) => (
                <option key={p.ips} value={p.ips}>
                  {p.razonSocial} — NIT {p.nit}
                </option>
              ))}
            </Select>

            {!ipsSeleccionado && (
              <>
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
              </>
            )}

            <Button onClick={consultar} disabled={cargando || cargandoOpciones}>
              Consultar
            </Button>
          </div>

          {ipsSeleccionado && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              {cargandoContratosPrestador ? (
                <p className="text-xs text-muted-foreground">Cargando contratos del prestador…</p>
              ) : contratosPrestador.length === 0 ? (
                <p className="text-xs text-muted-foreground">Este prestador no tiene contratos vigentes con tarifario activo.</p>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Contrato(s) de este prestador — elija uno, varios o todos
                    </p>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() =>
                        setContratosSeleccionados(
                          contratosSeleccionados.size === contratosPrestador.length
                            ? new Set()
                            : new Set(contratosPrestador.map((c) => c.numeroContrato))
                        )
                      }
                    >
                      {contratosSeleccionados.size === contratosPrestador.length ? "Ninguno" : "Todos"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {contratosPrestador.map((c) => {
                      const marcado = contratosSeleccionados.has(c.numeroContrato);
                      return (
                        <Badge
                          key={c.numeroContrato}
                          variant={marcado ? "default" : "outline"}
                          className="cursor-pointer select-none"
                          onClick={() => alternarContrato(c.numeroContrato)}
                        >
                          {c.numeroContrato} · {c.municipioNombre}
                        </Badge>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Municipio{municipiosDelPrestador.length !== 1 ? "s" : ""} de administración:{" "}
                    <strong className="text-foreground">
                      {municipiosDelPrestador.length > 0 ? municipiosDelPrestador.join(", ") : "—"}
                    </strong>
                    {" · "}El valor radicado ya está filtrado por el prestador completo — marcar uno o varios contratos aquí no
                    cambia el total, solo confirma en qué municipio(s) se administra cada contrato.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {errorConsulta && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorConsulta}</span>
        </div>
      )}

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
            <GraficoBarras
              titulo="Top 20 prestadores por valor radicado"
              datos={datosGraficoPrestadores}
              onDoubleClickItem={(i) => {
                const fila = resultado?.top20Prestadores[i];
                if (fila) abrirDrillPrestador(fila);
              }}
            />
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

      {/* Nivel 2 del drill-down: desglose de códigos del prestador elegido en "Top 20 prestadores". */}
      {drillPrestador && (
        <ModalOverlay
          titulo={`Desglose por código — ${drillPrestador.razonSocial}`}
          subtitulo={`${ETIQUETAS_TIPO_IMPACTO[tipo]} · Año ${resultado?.filtros.anio} · Total: ${formatearMoneda(drillPrestador.valorTotal)}`}
          onClose={cerrarDrillPrestador}
        >
          {drillPrestador.ips === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Este valor viene de un código de prestador (<span className="font-mono">{drillPrestador.razonSocial.replace("Código no registrado: ", "")}</span>)
              que no tiene fila propia en el maestro de prestadores (<code>ct_ips</code>) — por eso no se puede volver a filtrar por él para ver su
              desglose. Es dinero real (no un error de cálculo), pero de una sede/código de habilitación que TI todavía no ha registrado como
              prestador — ver KnowledgeBase/04-BaseDatos/Tablas.md.
            </p>
          ) : cargandoDrillNivel2 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando desglose por código…
            </div>
          ) : drillNivel2 ? (
            drillNivel2.top100.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin códigos radicados para este prestador en el período filtrado.</p>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {drillNivel2.top100.length} código(s) · doble clic sobre una fila para ver sus facturas.
                </p>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Valor total</TableHead>
                      <TableHead className="text-right">% del prestador</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drillNivel2.top100.map((f) => (
                      <TableRow
                        key={`${f.tipo}-${f.codigo}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onDoubleClick={() => abrirDrillCodigo(f)}
                        title="Doble clic para ver las facturas de este código"
                      >
                        <TableCell>
                          <Badge variant="outline">{ETIQUETAS_TIPO_CORTA[f.tipo]}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{f.codigo}</TableCell>
                        <TableCell className="whitespace-normal break-words">{f.descripcion}</TableCell>
                        <TableCell className="text-right">{f.cantidad.toLocaleString("es-CO")}</TableCell>
                        <TableCell className="text-right font-semibold">{formatearMoneda(f.valorTotal)}</TableCell>
                        <TableCell className="text-right">{formatearPorcentaje(f.pctDelTotal, 1)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )
          ) : null}
        </ModalOverlay>
      )}

      {/* Nivel 3 del drill-down: facturas del código elegido dentro del Nivel 2. */}
      {drillCodigo && (
        <ModalOverlay
          titulo={`Facturas — ${drillCodigo.codigo}`}
          subtitulo={`${drillCodigo.descripcion} · ${drillPrestador?.razonSocial ?? ""}`}
          onClose={cerrarDrillCodigo}
        >
          {cargandoDrillNivel3 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Consultando facturas (puede tardar unos segundos)…
            </div>
          ) : drillNivel3 ? (
            drillNivel3.totalFacturas === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No se encontraron facturas para este código en el año {drillNivel3.anio}.
              </p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Total facturas</p>
                    <p className="text-lg font-bold">{drillNivel3.totalFacturas.toLocaleString("es-CO")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total cantidad</p>
                    <p className="text-lg font-bold">{drillNivel3.totalCantidad.toLocaleString("es-CO")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total facturado</p>
                    <p className="text-lg font-bold">{formatearMoneda(drillNivel3.totalValor)}</p>
                  </div>
                </div>
                {drillNivel3.facturas.length < drillNivel3.totalFacturas ? (
                  <p className="mb-2 text-center text-[11px] text-muted-foreground">
                    Mostrando las {drillNivel3.facturas.length.toLocaleString("es-CO")} facturas más recientes de{" "}
                    {drillNivel3.totalFacturas.toLocaleString("es-CO")} en total (los totales de arriba sí incluyen todas).
                  </p>
                ) : null}
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>N° Factura</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drillNivel3.facturas.map((f) => (
                      <TableRow key={`${f.numeroFactura}__${f.fecha}`}>
                        <TableCell className="font-mono text-xs">{f.numeroFactura}</TableCell>
                        <TableCell className="text-xs">{f.fecha ? formatearFecha(f.fecha) : "—"}</TableCell>
                        <TableCell className="text-right">{f.cantidad.toLocaleString("es-CO")}</TableCell>
                        <TableCell className="text-right">{formatearMoneda(f.valor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )
          ) : null}
        </ModalOverlay>
      )}
    </div>
  );
}
