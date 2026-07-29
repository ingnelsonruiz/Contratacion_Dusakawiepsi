"use client";

/**
 * UI compartida del "semáforo" de variación porcentual (dirección-consciente:
 * rojo/ámbar = más caro que la referencia, azul = más barato — ver
 * clasificarSemaforo() en src/lib/negociacion/comparativo.ts).
 *
 * Extraído de comparativo-client.tsx (Módulo 2) el 2026-07-28 para
 * reutilizarlo tal cual en el nuevo módulo de Histórico del Prestador — la
 * semántica de "aumentó = riesgo, disminuyó = favorable" es la MISMA en
 * ambos módulos, solo cambia contra qué se compara (otro prestador vs. el
 * propio histórico).
 */

import { useEffect, useRef, useState } from "react";
import ChevronDown from "lucide-react/icons/chevron-down";
import Filter from "lucide-react/icons/filter";

import { Button } from "@/components/ui/button";
import type { NivelSemaforo } from "@/types/comparativo";

// Rojo/ámbar = más caro que la referencia (sobrecosto, sí es un riesgo a
// vigilar). Azul = más barato (no es un riesgo, es una oportunidad/dato a
// revisar con otro criterio) — ver comentario en clasificarSemaforo().
export function colorSemaforo(nivel: NivelSemaforo): string {
  if (nivel === "critico") return "border-transparent bg-red-600 text-white";
  if (nivel === "alerta") return "border-transparent bg-amber-500 text-white";
  if (nivel === "muyFavorable") return "border-transparent bg-sky-600 text-white";
  if (nivel === "favorable") return "border-transparent bg-sky-400 text-white";
  return "border-transparent bg-emerald-600 text-white";
}

export const ESTADOS_SEMAFORO: { valor: NivelSemaforo; etiqueta: string; dot: string }[] = [
  { valor: "critico", etiqueta: "Crítico (más caro)", dot: "bg-red-600" },
  { valor: "alerta", etiqueta: "Alerta (más caro)", dot: "bg-amber-500" },
  { valor: "ok", etiqueta: "OK", dot: "bg-emerald-600" },
  { valor: "favorable", etiqueta: "Favorable (más barato)", dot: "bg-sky-400" },
  { valor: "muyFavorable", etiqueta: "Muy favorable (más barato)", dot: "bg-sky-600" },
];

/**
 * Menú desplegable multi-selección para filtrar por estado(s) de semáforo —
 * pedido por el usuario 2026-07-28 para no tener que abrir fila por fila
 * buscando, por ejemplo, todos los "Crítico" de un municipio. Sin
 * dependencia nueva (no hay un DropdownMenu/Popover en @/components/ui
 * todavía): panel flotante casero con cierre al hacer clic afuera.
 */
export function FiltroEstadosSemaforo({
  seleccionados,
  onChange,
}: {
  seleccionados: NivelSemaforo[];
  onChange: (v: NivelSemaforo[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function alClickAfuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", alClickAfuera);
    return () => document.removeEventListener("mousedown", alClickAfuera);
  }, []);

  function alternar(valor: NivelSemaforo) {
    onChange(seleccionados.includes(valor) ? seleccionados.filter((v) => v !== valor) : [...seleccionados, valor]);
  }

  const etiquetaBoton =
    seleccionados.length === 0
      ? "Todos los estados"
      : seleccionados.length === 1
        ? ESTADOS_SEMAFORO.find((e) => e.valor === seleccionados[0])?.etiqueta
        : `${seleccionados.length} estados seleccionados`;

  return (
    <div className="relative w-full sm:w-64" ref={ref}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setAbierto((v) => !v)}
        className="w-full justify-between font-normal"
      >
        <span className="flex items-center gap-2 truncate">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
          {etiquetaBoton}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>
      {abierto && (
        <div className="absolute z-20 mt-1 w-full min-w-64 rounded-md border bg-background p-1.5 shadow-md">
          {ESTADOS_SEMAFORO.map((e) => (
            <label
              key={e.valor}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={seleccionados.includes(e.valor)}
                onChange={() => alternar(e.valor)}
                className="h-4 w-4 rounded border-input"
              />
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${e.dot}`} />
              {e.etiqueta}
            </label>
          ))}
          {seleccionados.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Limpiar filtro
            </button>
          )}
        </div>
      )}
    </div>
  );
}
