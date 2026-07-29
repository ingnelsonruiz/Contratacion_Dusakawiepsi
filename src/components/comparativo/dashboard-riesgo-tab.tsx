"use client";

/**
 * Pestaña "Dashboard Analítico de Competitividad y Riesgo Contractual" —
 * Fase A (pedida por el usuario 2026-07-29, ver KnowledgeBase/05-ReglasNegocio/
 * Contratación.md para el alcance completo y las decisiones tomadas vía
 * AskUserQuestion antes de construir esto).
 *
 * Componente separado de `comparativo-client.tsx` (que ya es grande y tiene
 * historial de corrupción por bytes NUL al editarlo con Edit/Write — ver
 * KnowledgeBase/09-Errores) para aislar el riesgo: este archivo es nuevo,
 * `comparativo-client.tsx` solo gana 2 líneas para montar esta pestaña.
 *
 * Sin librería de gráficos de terceros (recharts falló al instalar en este
 * entorno, ver KB) — ranking y distribución de estados son barras
 * horizontales con `<div>` + Tailwind (ancho = %), heatmap es una tabla con
 * color de fondo interpolado por CSS. Mismo criterio ya usado para el
 * gráfico de Módulo 3 (`GraficoPuntos`, SVG propio).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Building2 from "lucide-react/icons/building-2";
import AlertTriangle from "lucide-react/icons/alert-triangle";
import Sparkles from "lucide-react/icons/sparkles";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { FiltroEstadosSemaforo } from "@/components/comparativo/semaforo-ui";
import { formatearMoneda, formatearPorcentaje } from "@/lib/negociacion/formato";
import { etiquetaNivelRiesgo } from "@/lib/negociacion/dashboard-riesgo";
import {
  getDashboardRiesgoContractual,
  getOpcionesTipoContrato,
  getOpcionesNivelComplejidad,
  getOpcionesPrestadoresRiesgo,
} from "@/app/actions/dashboard-riesgo-actions";
import { getOpcionesMunicipios } from "@/app/actions/comparativo-actions";
import type { TipoComparativo, ReferenciaVariacion, UmbralesSemaforo, NivelSemaforo, OpcionMunicipio } from "@/types/comparativo";
import type {
  ResultadoDashboardRiesgo,
  OpcionTipoContrato,
  OpcionNivelComplejidad,
  NivelRiesgo,
  FilaRankingRiesgo,
} from "@/types/dashboard-riesgo";

const COLOR_NIVEL_RIESGO: Record<NivelRiesgo, string> = {
  bajo: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medio: "bg-amber-100 text-amber-800 border-amber-200",
  alto: "bg-orange-100 text-orange-800 border-orange-200",
  muyAlto: "bg-red-100 text-red-800 border-red-200",
};

/**
 * Doble clic abre el detalle de cómo se calcula ese KPI — pedido del usuario
 * 2026-07-29 ("es bueno saber cómo se calculan los KPI... y que yo pueda dar
 * doble clic y que me lleve a esa información"), mismo patrón ya usado para
 * "Amplitud" en el Módulo 2 (menú emergente, no tooltip de hover).
 */
function TarjetaKpiRiesgo({
  etiqueta,
  valor,
  sub,
  tono,
  onDoubleClick,
}: {
  etiqueta: string;
  valor: string;
  sub?: string;
  tono?: "rojo" | "azul" | "neutro";
  onDoubleClick?: () => void;
}) {
  const colorValor = tono === "rojo" ? "text-red-600" : tono === "azul" ? "text-sky-600" : "text-foreground";
  return (
    <Card
      onDoubleClick={onDoubleClick}
      className={onDoubleClick ? "cursor-pointer transition-colors hover:border-primary" : undefined}
    >
      <CardContent className="pt-5">
        <p className="text-xs font-medium text-muted-foreground">{etiqueta}</p>
        <p className={`mt-1 text-lg font-bold underline decoration-dotted underline-offset-4 ${colorValor}`}>{valor}</p>
        {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
        {onDoubleClick ? <p className="mt-1 text-[10px] font-medium text-primary">doble clic = ver los datos/procedimientos</p> : null}
      </CardContent>
    </Card>
  );
}

/** Overlay de menú emergente compartido — mismo criterio que ModalDetalleAmplitud en comparativo-client.tsx: overlay propio, no un Dialog de terceros (no hay @radix-ui/react-dialog instalado). */
function ModalInfo({ titulo, subtitulo, onClose, children }: { titulo: string; subtitulo?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="max-h-[85vh] w-full max-w-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Cómo se calcula</p>
              <p className="text-sm font-semibold">{titulo}</p>
              {subtitulo ? <p className="text-xs text-muted-foreground">{subtitulo}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded border px-2 py-1 text-xs font-medium hover:bg-muted"
            >
              Cerrar
            </button>
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

/** Barra horizontal simple (div con ancho %) — usada en el ranking y en la distribución de estados. */
function BarraHorizontal({ etiqueta, valor, maximo, colorClase, valorTexto }: { etiqueta: string; valor: number; maximo: number; colorClase: string; valorTexto: string }) {
  const pct = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-48 shrink-0 truncate" title={etiqueta}>
        {etiqueta}
      </span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
        <div className={`h-full ${colorClase}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 shrink-0 text-right font-medium">{valorTexto}</span>
    </div>
  );
}

/** Interpola un color de fondo (verde→rojo) según un % 0-100 — heatmap sin librería. */
function colorHeatmap(pct: number): string {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  // 0% = verde suave, 100% = rojo intenso.
  const r = Math.round(220 + (185 - 220) * p + p * 35);
  const g = Math.round(240 - 180 * p);
  const b = Math.round(210 - 190 * p);
  return `rgb(${Math.min(255, r + p * 35)}, ${Math.max(0, g)}, ${Math.max(0, b)})`;
}

/**
 * Encabezado corto (fórmula, 1 línea) por KPI — se muestra arriba de la
 * tabla de datos reales dentro del menú emergente, solo para orientar qué se
 * está mirando. El usuario pidió explícitamente que el doble clic lleve al
 * DATO (los procedimientos/valores que generan el número), no que se quede
 * solo en la descripción — por eso el cuerpo del modal es una tabla, no
 * texto (ver `TablaFuenteKpi` más abajo).
 */
function formulaCortaKpi(clave: string, referencia: ReferenciaVariacion): string {
  const etiquetaRef = referencia === "promedio" ? "promedio" : "mediana";
  const mapa: Record<string, string> = {
    codigosComparables: "1 fila = 1 grupo (municipio + código) con 2 o más prestadores comparados.",
    totalPrestadores: "1 fila = 1 prestador con al menos un código comparado.",
    totalMunicipios: "1 fila = 1 municipio con al menos un código comparado.",
    valorPromedioMercado: `Promedio simple de estos valores tarifados = ${etiquetaRef === "promedio" ? "" : ""}valor promedio de mercado.`,
    variabilidadPromedio: `Amplitud % de cada grupo = (máximo − mínimo) / ${etiquetaRef} × 100 — promediadas da la Variabilidad promedio.`,
    cantidadCritico: `1 fila = 1 aparición prestador+código clasificada "Crítico" contra el ${etiquetaRef} de su grupo.`,
    cantidadAlerta: `1 fila = 1 aparición prestador+código clasificada "Alerta" contra el ${etiquetaRef} de su grupo.`,
    cantidadOk: `1 fila = 1 aparición prestador+código clasificada "OK" (dentro del umbral de alerta) contra el ${etiquetaRef} de su grupo.`,
    cantidadFavorable: `1 fila = 1 aparición prestador+código clasificada "Favorable" (más barato) contra el ${etiquetaRef} de su grupo.`,
    cantidadMuyFavorable: `1 fila = 1 aparición prestador+código clasificada "Muy favorable" contra el ${etiquetaRef} de su grupo.`,
    pctNegociacionCritica: `Mismas filas que "Tarifas críticas" — el % es cuántas de estas hay sobre el total de apariciones.`,
  };
  return mapa[clave] ?? "";
}

/** Tabla con el DATO real que sustenta cada KPI — pedido explícito del usuario 2026-07-29 ("no la descripción del KPI, la fuente/los datos que lo generan"). */
function TablaFuenteKpi({ clave, resultado, referencia }: { clave: string; resultado: ResultadoDashboardRiesgo; referencia: ReferenciaVariacion }) {
  const etiquetaRef = referencia === "promedio" ? "Promedio" : "Mediana";

  if (clave === "totalPrestadores") {
    const filas = [...resultado.ranking].sort((a, b) => b.totalApariciones - a.totalApariciones);
    return (
      <TablaGenerica
        columnas={["Prestador", "NIT", "Municipios", "Códigos comparados", "% crítico"]}
        filas={filas.map((r) => [r.razonSocial, r.nit, r.municipiosDondeOpera.join(", "), r.totalApariciones.toLocaleString("es-CO"), `${r.pctCritico.toFixed(0)}%`])}
      />
    );
  }

  if (clave === "totalMunicipios") {
    const filas = [...resultado.heatmap].sort((a, b) => b.cantidadCodigos - a.cantidadCodigos);
    return (
      <TablaGenerica
        columnas={["Municipio", "Departamento", "Códigos comparados", "% crítico", "Amplitud promedio"]}
        filas={filas.map((h) => [h.municipioNombre, h.departamentoNombre, h.cantidadCodigos.toLocaleString("es-CO"), `${h.pctCritico.toFixed(0)}%`, formatearPorcentaje(h.amplitudPromedio, 0)])}
      />
    );
  }

  if (clave === "codigosComparables" || clave === "valorPromedioMercado" || clave === "variabilidadPromedio") {
    const ordenPor = clave === "variabilidadPromedio" ? "amplitud" : clave === "valorPromedioMercado" ? "promedio" : "codigo";
    const filas = [...resultado.detalleGrupos].sort((a, b) => {
      if (ordenPor === "amplitud") return b.amplitud - a.amplitud;
      if (ordenPor === "promedio") return b.promedio - a.promedio;
      return a.codigoTarifa.localeCompare(b.codigoTarifa);
    });
    return (
      <TablaGenerica
        columnas={["Código", "Descripción", "Municipio", "Prestadores", "Mínimo", "Máximo", etiquetaRef, "Amplitud"]}
        filas={filas.map((g) => [
          g.codigoTarifa,
          g.descripcion,
          g.municipioNombre,
          String(g.cantidadPrestadores),
          formatearMoneda(g.minimo),
          formatearMoneda(g.maximo),
          formatearMoneda(referencia === "promedio" ? g.promedio : g.mediana),
          formatearPorcentaje(g.amplitud, 0),
        ])}
      />
    );
  }

  // Tarifas críticas/alerta/OK/favorables/muy favorables + % negociación crítica
  const nivel: NivelSemaforo =
    clave === "cantidadAlerta"
      ? "alerta"
      : clave === "cantidadOk"
        ? "ok"
        : clave === "cantidadFavorable"
          ? "favorable"
          : clave === "cantidadMuyFavorable"
            ? "muyFavorable"
            : "critico";
  const filas = resultado.detallePorNivel[nivel] ?? [];
  return (
    <>
      {filas.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Sin apariciones en este estado para los filtros actuales.</p>
      ) : (
        <TablaGenerica
          columnas={["Código", "Descripción", "Prestador", "Municipio", "Valor", etiquetaRef, "Diferencia"]}
          filas={filas.map((f) => [
            f.codigoTarifa,
            f.descripcion,
            f.razonSocial,
            f.municipioNombre,
            formatearMoneda(f.valorFinal),
            formatearMoneda(f.valorReferencia),
            `${f.diferenciaAbsoluta >= 0 ? "+" : ""}${formatearMoneda(f.diferenciaAbsoluta)} (${formatearPorcentaje(f.diferenciaPct, 0)})`,
          ])}
        />
      )}
    </>
  );
}

/** Tabla simple de solo lectura (filas de strings ya formateados) — para no repetir el mismo <table> 4 veces en TablaFuenteKpi. */
function TablaGenerica({ columnas, filas }: { columnas: string[]; filas: string[][] }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {columnas.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={i} className="border-b last:border-0">
              {fila.map((valor, j) => (
                <td key={j} className={`max-w-[220px] truncate px-2 py-1 ${j >= fila.length - 3 ? "whitespace-nowrap text-right" : ""}`} title={valor}>
                  {valor}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TITULOS_KPI: Record<string, string> = {
  codigosComparables: "Códigos comparables",
  totalPrestadores: "Prestadores analizados",
  totalMunicipios: "Municipios analizados",
  valorPromedioMercado: "Valor promedio de mercado",
  variabilidadPromedio: "Variabilidad promedio",
  cantidadCritico: "Tarifas críticas",
  cantidadAlerta: "Tarifas en alerta",
  cantidadOk: "Tarifas OK",
  cantidadFavorable: "Tarifas favorables",
  cantidadMuyFavorable: "Tarifas muy favorables",
  pctNegociacionCritica: "% negociación crítica",
};

/** Mensajes rotativos de la barra de carga — reflejan a grandes rasgos las etapas reales de `construirDashboardRiesgo` (no son pasos medidos, solo contexto para el usuario). */
const MENSAJES_CARGA_DASHBOARD = [
  "Consultando tarifario vigente por prestador y municipio…",
  "Cruzando precios dentro de cada municipio…",
  "Calculando amplitud, desviación y semáforo por código…",
  "Construyendo ranking de riesgo por prestador…",
  "Agregando heatmap y oportunidad de ahorro…",
];

/** Barra de progreso simple (div con ancho %) con animación suave — evitamos una librería de terceros, mismo criterio que `BarraHorizontal`. */
function BarraProgresoCarga({ progreso, mensaje }: { progreso: number; mensaje: string }) {
  return (
    <div className="mx-auto max-w-md space-y-3 py-6 text-center">
      <p className="text-sm font-medium">Calculando dashboard…</p>
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

export function DashboardRiesgoTab({
  tipo,
  referencia,
  umbrales,
}: {
  tipo: TipoComparativo;
  referencia: ReferenciaVariacion;
  umbrales: UmbralesSemaforo;
}) {
  const [municipios, setMunicipios] = useState<OpcionMunicipio[]>([]);
  const [prestadores, setPrestadores] = useState<{ ips: number; razonSocial: string; nit: string }[]>([]);
  const [opcionesTipoContrato, setOpcionesTipoContrato] = useState<OpcionTipoContrato[]>([]);
  const [opcionesNivelComplejidad, setOpcionesNivelComplejidad] = useState<OpcionNivelComplejidad[]>([]);

  const [municipioCodigo, setMunicipioCodigo] = useState<string>("");
  const [ips, setIps] = useState<string>("");
  const [tipoContratoFiltro, setTipoContratoFiltro] = useState<number[]>([]);
  const [nivelComplejidadFiltro, setNivelComplejidadFiltro] = useState<number[]>([]);
  const [estadosFiltro, setEstadosFiltro] = useState<NivelSemaforo[]>([]);
  const [busquedaPrestador, setBusquedaPrestador] = useState("");

  const [resultado, setResultado] = useState<ResultadoDashboardRiesgo | null>(null);
  const [cargando, setCargando] = useState(false);
  // Progreso simulado de carga — el cálculo es UNA sola consulta al proxy (no hay
  // pasos discretos reales que reportar desde el servidor), así que se anima un
  // % que avanza rápido al inicio y se frena cerca del 90% mientras se espera la
  // respuesta real; al llegar el resultado salta a 100% y se oculta. Pedido por
  // el usuario 2026-07-29 tras ver la pantalla "en blanco" mientras cargaba:
  // "mejora la experiencia... con una barra de porcentaje de carga para que no
  // se desespere el usuario".
  const [progresoCarga, setProgresoCarga] = useState(0);
  const [mensajeCargaIdx, setMensajeCargaIdx] = useState(0);

  // Menús emergentes de doble clic — pedido del usuario 2026-07-29.
  const [kpiSeleccionado, setKpiSeleccionado] = useState<string | null>(null);
  const [prestadorSeleccionado, setPrestadorSeleccionado] = useState<FilaRankingRiesgo | null>(null);

  // Opciones de filtro — se recargan cuando cambia el tipo de tarifario.
  useEffect(() => {
    let cancelado = false;
    Promise.all([getOpcionesMunicipios(tipo), getOpcionesPrestadoresRiesgo(tipo), getOpcionesTipoContrato(), getOpcionesNivelComplejidad()]).then(
      ([m, p, tc, nc]) => {
        if (cancelado) return;
        setMunicipios(m);
        setPrestadores(p);
        setOpcionesTipoContrato(tc);
        setOpcionesNivelComplejidad(nc);
      }
    );
    return () => {
      cancelado = true;
    };
  }, [tipo]);

  // Resultado del dashboard — se recarga con cualquier filtro/umbral/referencia.
  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setProgresoCarga(0);
    getDashboardRiesgoContractual(tipo, {
      municipioCodigo: municipioCodigo || undefined,
      ips: ips ? Number(ips) : undefined,
      tipoContrato: tipoContratoFiltro.length > 0 ? tipoContratoFiltro : undefined,
      nivelComplejidad: nivelComplejidadFiltro.length > 0 ? nivelComplejidadFiltro : undefined,
      estadosFiltro: estadosFiltro.length > 0 ? estadosFiltro : undefined,
      referencia,
      umbrales,
    })
      .then((res) => {
        if (!cancelado) setResultado(res);
      })
      .finally(() => {
        if (!cancelado) {
          setProgresoCarga(100);
          setCargando(false);
        }
      });
    return () => {
      cancelado = true;
    };
  }, [tipo, municipioCodigo, ips, tipoContratoFiltro, nivelComplejidadFiltro, estadosFiltro, referencia, umbrales]);

  // Anima progresoCarga mientras `cargando` está activo — avanza rápido al
  // inicio y se frena acercándose al 92% (nunca llega solo por tiempo, para
  // no mentirle al usuario que ya terminó cuando la respuesta real aún no
  // llega). Independiente del useEffect de arriba para no reiniciar el
  // intervalo cada vez que cambia un filtro dentro de la misma carga.
  useEffect(() => {
    if (!cargando) return;
    const intervalo = setInterval(() => {
      setProgresoCarga((actual) => {
        if (actual >= 92) return actual;
        const incremento = Math.max(0.4, (92 - actual) * 0.06);
        return Math.min(92, actual + incremento);
      });
    }, 200);
    return () => clearInterval(intervalo);
  }, [cargando]);

  // Rota el mensaje de "qué está haciendo" cada 2.2s mientras carga — le da
  // sensación de progreso real aunque sea una sola consulta al proxy.
  useEffect(() => {
    if (!cargando) {
      setMensajeCargaIdx(0);
      return;
    }
    const intervalo = setInterval(() => {
      setMensajeCargaIdx((i) => (i + 1) % MENSAJES_CARGA_DASHBOARD.length);
    }, 2200);
    return () => clearInterval(intervalo);
  }, [cargando]);

  const prestadoresFiltrados = useMemo(() => {
    const q = busquedaPrestador.trim().toLowerCase();
    if (!q) return prestadores;
    return prestadores.filter((p) => p.razonSocial.toLowerCase().includes(q) || p.nit.includes(q));
  }, [prestadores, busquedaPrestador]);

  function alternarEnLista(lista: number[], valor: number, setLista: (v: number[]) => void) {
    setLista(lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]);
  }

  const maximoCostoRanking = resultado ? Math.max(1, ...resultado.ranking.map((r) => r.costoPotencialAdicional)) : 1;
  const maximoTotalDistribucion = resultado ? Math.max(1, ...resultado.distribucionEstados.map((d) => d.total)) : 1;

  return (
    <div className="space-y-4">
      {/* --- Filtros / segmentadores (sección 10 del pedido) --- */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={municipioCodigo} onChange={(e) => setMunicipioCodigo(e.target.value)} className="w-56">
              <option value="">Todos los municipios</option>
              {municipios.map((m) => (
                <option key={m.municipioCodigo} value={m.municipioCodigo}>
                  {m.municipioNombre}
                </option>
              ))}
            </Select>

            <div className="flex items-center gap-1">
              <Input
                value={busquedaPrestador}
                onChange={(e) => setBusquedaPrestador(e.target.value)}
                placeholder="Buscar prestador…"
                className="w-40"
              />
              <Select value={ips} onChange={(e) => setIps(e.target.value)} className="w-56">
                <option value="">Todos los prestadores</option>
                {prestadoresFiltrados.map((p) => (
                  <option key={p.ips} value={p.ips}>
                    {p.razonSocial}
                  </option>
                ))}
              </Select>
            </div>

            <FiltroEstadosSemaforo seleccionados={estadosFiltro} onChange={setEstadosFiltro} />
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-muted-foreground">Tipo de contrato:</span>
              {opcionesTipoContrato.map((o) => (
                <label key={o.tipoContrato} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={tipoContratoFiltro.includes(o.tipoContrato)}
                    onChange={() => alternarEnLista(tipoContratoFiltro, o.tipoContrato, setTipoContratoFiltro)}
                  />
                  {o.descripcion}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-muted-foreground">Nivel de complejidad:</span>
              {opcionesNivelComplejidad.map((o) => (
                <label key={o.nivelComplejidad} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={nivelComplejidadFiltro.includes(o.nivelComplejidad)}
                    onChange={() => alternarEnLista(nivelComplejidadFiltro, o.nivelComplejidad, setNivelComplejidadFiltro)}
                  />
                  {o.etiqueta}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {cargando && !resultado ? (
        <Card>
          <CardContent>
            <BarraProgresoCarga progreso={progresoCarga} mensaje={MENSAJES_CARGA_DASHBOARD[mensajeCargaIdx]} />
          </CardContent>
        </Card>
      ) : !resultado || resultado.kpis.totalCodigosComparables === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Sin datos comparables para los filtros actuales.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* --- 1. KPIs ejecutivos --- */}
          <p className="text-[11px] text-muted-foreground">Doble clic sobre cualquier tarjeta para ver los códigos/prestadores/valores reales que generan ese número.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <TarjetaKpiRiesgo
              etiqueta="Códigos comparables"
              valor={resultado.kpis.totalCodigosComparables.toLocaleString("es-CO")}
              onDoubleClick={() => setKpiSeleccionado("codigosComparables")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Prestadores analizados"
              valor={resultado.kpis.totalPrestadores.toLocaleString("es-CO")}
              onDoubleClick={() => setKpiSeleccionado("totalPrestadores")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Municipios analizados"
              valor={resultado.kpis.totalMunicipios.toLocaleString("es-CO")}
              onDoubleClick={() => setKpiSeleccionado("totalMunicipios")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Valor promedio de mercado"
              valor={formatearMoneda(resultado.kpis.valorPromedioMercado)}
              onDoubleClick={() => setKpiSeleccionado("valorPromedioMercado")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Variabilidad promedio"
              valor={formatearPorcentaje(resultado.kpis.variabilidadPromedio, 0)}
              onDoubleClick={() => setKpiSeleccionado("variabilidadPromedio")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Tarifas críticas"
              valor={resultado.kpis.cantidadCritico.toLocaleString("es-CO")}
              tono="rojo"
              onDoubleClick={() => setKpiSeleccionado("cantidadCritico")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Tarifas en alerta"
              valor={resultado.kpis.cantidadAlerta.toLocaleString("es-CO")}
              tono="rojo"
              onDoubleClick={() => setKpiSeleccionado("cantidadAlerta")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Tarifas OK"
              valor={resultado.kpis.cantidadOk.toLocaleString("es-CO")}
              onDoubleClick={() => setKpiSeleccionado("cantidadOk")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Tarifas favorables"
              valor={resultado.kpis.cantidadFavorable.toLocaleString("es-CO")}
              tono="azul"
              onDoubleClick={() => setKpiSeleccionado("cantidadFavorable")}
            />
            <TarjetaKpiRiesgo
              etiqueta="Tarifas muy favorables"
              valor={resultado.kpis.cantidadMuyFavorable.toLocaleString("es-CO")}
              tono="azul"
              onDoubleClick={() => setKpiSeleccionado("cantidadMuyFavorable")}
            />
            <TarjetaKpiRiesgo
              etiqueta="% negociación crítica"
              valor={formatearPorcentaje(resultado.kpis.pctNegociacionCritica, 1)}
              sub={`sobre ${resultado.kpis.totalEntradasClasificadas.toLocaleString("es-CO")} apariciones`}
              tono="rojo"
              onDoubleClick={() => setKpiSeleccionado("pctNegociacionCritica")}
            />
          </div>

          {/* --- 12. Narrativa automática --- */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="space-y-1.5 pt-6">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-primary">
                <Sparkles className="h-4 w-4" /> Lectura automática (por reglas, no generada por IA)
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                {resultado.narrativa.map((frase, i) => (
                  <li key={i}>{frase}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* --- 8. Oportunidad de ahorro --- */}
          <Card className="border-emerald-200 bg-emerald-50/60">
            <CardContent className="flex flex-col items-center justify-center gap-1 py-6 text-center">
              <p className="text-sm font-medium text-muted-foreground">Potencial de ahorro estimado (tarifas críticas → {referencia === "promedio" ? "promedio" : "mediana"})</p>
              <p className="text-4xl font-bold text-emerald-700">{formatearMoneda(resultado.ahorro.totalGlobal)}</p>
              <p className="text-xs text-muted-foreground">Por unidad tarifada — no proyectado por volumen real de servicios prestados (no hay datos RIPS en este cálculo).</p>
            </CardContent>
          </Card>

          {/* --- 2 y 3. Ranking de riesgo + score --- */}
          <Card>
            <CardContent className="pt-6">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-orange-600" /> Ranking de prestadores por riesgo contractual
              </div>
              <p className="mb-3 text-[11px] text-muted-foreground">Doble clic sobre un prestador para ver el detalle del score y qué códigos generan su sobrecosto.</p>
              <div className="space-y-3">
                {resultado.ranking.slice(0, 15).map((r) => (
                  <div
                    key={r.ips}
                    className="cursor-pointer space-y-1 rounded-md border-b pb-2 transition-colors last:border-0 hover:bg-muted/40"
                    onDoubleClick={() => setPrestadorSeleccionado(r)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium underline decoration-dotted underline-offset-4">{r.razonSocial}</span>
                      <div className="flex items-center gap-2">
                        <Badge className={COLOR_NIVEL_RIESGO[r.nivelRiesgo]}>
                          {etiquetaNivelRiesgo(r.nivelRiesgo)} · Score {r.score}
                        </Badge>
                        <Badge variant="outline">{r.pctCritico.toFixed(0)}% crítico</Badge>
                      </div>
                    </div>
                    <BarraHorizontal
                      etiqueta="Costo potencial adicional"
                      valor={Math.max(0, r.costoPotencialAdicional)}
                      maximo={maximoCostoRanking}
                      colorClase="bg-red-500"
                      valorTexto={formatearMoneda(r.costoPotencialAdicional)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {r.totalApariciones} códigos comparados en {r.municipiosDondeOpera.length} municipio(s) · desviación promedio{" "}
                      {r.indiceDesviacionMedio.toFixed(0)}%
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* --- 5. Distribución de estados por prestador --- */}
          <Card>
            <CardContent className="pt-6">
              <p className="mb-3 text-sm font-semibold">Distribución de estados por prestador</p>
              <div className="space-y-2">
                {resultado.distribucionEstados.slice(0, 15).map((d) => (
                  <div key={d.ips} className="flex items-center gap-2 text-xs">
                    <span className="w-48 shrink-0 truncate" title={d.razonSocial}>
                      {d.razonSocial}
                    </span>
                    <div className="flex h-4 flex-1 overflow-hidden rounded bg-muted">
                      {d.cantidadMuyFavorable > 0 && <div className="h-full bg-sky-700" style={{ width: `${(d.cantidadMuyFavorable / d.total) * 100}%` }} title="Muy favorable" />}
                      {d.cantidadFavorable > 0 && <div className="h-full bg-sky-400" style={{ width: `${(d.cantidadFavorable / d.total) * 100}%` }} title="Favorable" />}
                      {d.cantidadOk > 0 && <div className="h-full bg-slate-300" style={{ width: `${(d.cantidadOk / d.total) * 100}%` }} title="OK" />}
                      {d.cantidadAlerta > 0 && <div className="h-full bg-amber-400" style={{ width: `${(d.cantidadAlerta / d.total) * 100}%` }} title="Alerta" />}
                      {d.cantidadCritico > 0 && <div className="h-full bg-red-600" style={{ width: `${(d.cantidadCritico / d.total) * 100}%` }} title="Crítico" />}
                    </div>
                    <span className="w-14 shrink-0 text-right font-medium">{d.total}</span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-700" /> Muy favorable</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-400" /> Favorable</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" /> OK</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Alerta</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-600" /> Crítico</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* --- 4. Heatmap por municipio --- */}
          <Card>
            <CardContent className="pt-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Building2 className="h-4 w-4" /> Heatmap por municipio (% de tarifas críticas)
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Agregado por municipio, no municipio × prestador — el módulo compara precios siempre dentro del mismo municipio; este mapa
                muestra dónde se concentra la inestabilidad, no cruza prestadores de municipios distintos entre sí.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {resultado.heatmap.map((h) => (
                  <div
                    key={h.municipioCodigo}
                    className="rounded-md border p-2 text-xs"
                    style={{ backgroundColor: colorHeatmap(h.pctCritico) }}
                    title={`${h.cantidadCritico} de ${h.cantidadCodigos} códigos críticos`}
                  >
                    <p className="font-medium">{h.municipioNombre}</p>
                    <p className="text-[11px]">{h.pctCritico.toFixed(0)}% crítico · amplitud {h.amplitudPromedio.toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* --- 9. Top 20 procedimientos más críticos --- */}
          <Card>
            <CardContent className="pt-6">
              <p className="mb-3 text-sm font-semibold">Top {resultado.top20.length} procedimientos más críticos</p>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead>Prestador</TableHead>
                      <TableHead>Municipio</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">{referencia === "promedio" ? "Promedio" : "Mediana"}</TableHead>
                      <TableHead className="text-right">Diferencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultado.top20.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                          Sin tarifas críticas para los filtros actuales.
                        </TableCell>
                      </TableRow>
                    ) : (
                      resultado.top20.map((f, i) => (
                        <TableRow key={`${f.codigoTarifa}-${f.razonSocial}-${i}`}>
                          <TableCell className="font-mono text-xs">{f.codigoTarifa}</TableCell>
                          <TableCell className="max-w-[260px] truncate" title={f.descripcion}>
                            {f.descripcion}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate" title={f.razonSocial}>
                            {f.razonSocial}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{f.municipioNombre}</TableCell>
                          <TableCell className="text-right">{formatearMoneda(f.valorFinal)}</TableCell>
                          <TableCell className="text-right">{formatearMoneda(f.valorReferencia)}</TableCell>
                          <TableCell className="text-right font-semibold text-red-600">
                            +{formatearMoneda(f.diferenciaAbsoluta)} ({formatearPorcentaje(f.diferenciaPct, 0)})
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {resultado && kpiSeleccionado ? (
        <ModalInfo titulo={TITULOS_KPI[kpiSeleccionado] ?? kpiSeleccionado} subtitulo={formulaCortaKpi(kpiSeleccionado, referencia)} onClose={() => setKpiSeleccionado(null)}>
          <TablaFuenteKpi clave={kpiSeleccionado} resultado={resultado} referencia={referencia} />
        </ModalInfo>
      ) : null}

      {prestadorSeleccionado ? (
        <ModalInfo
          titulo={`Score de riesgo — ${prestadorSeleccionado.razonSocial}`}
          subtitulo={`${prestadorSeleccionado.totalApariciones} códigos comparados en ${prestadorSeleccionado.municipiosDondeOpera.join(", ")}`}
          onClose={() => setPrestadorSeleccionado(null)}
        >
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                Score = round(componenteCríticas × 0.40 + componenteAlertas × 0.20 + componenteDesviación × 0.25 + componenteAmplitud × 0.15)
              </p>
              <p className="mt-1 text-muted-foreground">Cada componente está capado en 100 antes de ponderarse. Es un score heurístico de priorización para auditoría, no un modelo estadístico validado.</p>
            </div>

            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span>Componente Críticas = min(100, {prestadorSeleccionado.pctCritico.toFixed(1)}% × 2)</span>
                <span className="font-mono font-semibold">{prestadorSeleccionado.componenteCriticas.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Componente Alertas = min(100, {prestadorSeleccionado.pctAlerta.toFixed(1)}% × 1.5)</span>
                <span className="font-mono font-semibold">{prestadorSeleccionado.componenteAlertas.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Componente Desviación = min(100, {prestadorSeleccionado.indiceDesviacionMedio.toFixed(1)}% promedio)</span>
                <span className="font-mono font-semibold">{prestadorSeleccionado.componenteDesviacion.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Componente Amplitud = min(100, {prestadorSeleccionado.amplitudPromedio.toFixed(1)}% promedio de sus grupos)</span>
                <span className="font-mono font-semibold">{prestadorSeleccionado.componenteAmplitud.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-1.5 text-base font-bold">
                <span>Score final</span>
                <span>
                  {prestadorSeleccionado.score} — {etiquetaNivelRiesgo(prestadorSeleccionado.nivelRiesgo)}
                </span>
              </div>
            </div>

            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">
                Costo potencial adicional = suma de (valor tarifado − {referencia === "promedio" ? "promedio" : "mediana"} del grupo) en cada
                aparición crítica o en alerta
              </p>
              <p className="mt-1 text-lg font-bold text-red-600">{formatearMoneda(prestadorSeleccionado.costoPotencialAdicional)}</p>
              <p className="text-[11px] text-muted-foreground">
                Suma sobre {prestadorSeleccionado.cantidadSobrecostos.toLocaleString("es-CO")} apariciones crítico/alerta de este prestador.
              </p>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Códigos que más aportan al sobrecosto
                {prestadorSeleccionado.cantidadSobrecostos > prestadorSeleccionado.detalleSobrecostos.length
                  ? ` (mostrando los ${prestadorSeleccionado.detalleSobrecostos.length} mayores de ${prestadorSeleccionado.cantidadSobrecostos})`
                  : ""}
              </p>
              <div className="max-h-52 overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <tbody>
                    {prestadorSeleccionado.detalleSobrecostos.map((d, i) => (
                      <tr key={`${d.codigoTarifa}-${i}`} className="border-b last:border-0">
                        <td className="px-2 py-1 font-mono">{d.codigoTarifa}</td>
                        <td className="max-w-[180px] truncate px-2 py-1" title={d.descripcion}>
                          {d.descripcion}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{d.municipioNombre}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right font-semibold text-red-600">
                          +{formatearMoneda(d.diferenciaAbsoluta)} ({formatearPorcentaje(d.diferenciaPct, 0)})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ModalInfo>
      ) : null}
    </div>
  );
}
