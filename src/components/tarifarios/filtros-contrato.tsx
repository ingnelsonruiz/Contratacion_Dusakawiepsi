"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Search from "lucide-react/icons/search";
import X from "lucide-react/icons/x";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { OpcionFiltro } from "@/types/tarifarios";

interface FiltrosContratoProps {
  tiposContrato: OpcionFiltro[];
}

/**
 * Barra de filtros del listado de contratos. Actualiza los searchParams de
 * la URL (router.push con navegación de cliente, sin recarga completa) para
 * que /tarifarios (Server Component) vuelva a paginar del lado del servidor
 * — coherente con la arquitectura del proyecto (sin TanStack Query).
 *
 * Nota: el filtro por código `estado` (Estado 3/8/10) se retiró el
 * 2026-07-28 a pedido del usuario — no hay tabla maestra que traduzca ese
 * código a un significado de negocio claro, y el selector generaba más
 * confusión que utilidad. El código sigue visible como dato informativo en
 * otras partes si se necesita, solo no hay filtro por él.
 */
export function FiltrosContrato({ tiposContrato }: FiltrosContratoProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [busqueda, setBusqueda] = useState(searchParams.get("busqueda") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function actualizarParam(clave: string, valor: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (valor && valor !== "todos") {
      params.set(clave, valor);
    } else {
      params.delete(clave);
    }
    params.delete("page"); // toda edición de filtro reinicia a la página 1
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function handleBusquedaChange(valor: string) {
    setBusqueda(valor);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => actualizarParam("busqueda", valor || null), 400);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hayFiltrosActivos =
    searchParams.get("busqueda") || searchParams.get("tipoContrato") || searchParams.get("vigencia");

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full sm:w-72">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busqueda}
          onChange={(e) => handleBusquedaChange(e.target.value)}
          placeholder="Contrato, prestador o NIT…"
          className="pl-8"
        />
      </div>

      <Select
        className="w-full sm:w-48"
        value={searchParams.get("vigencia") ?? "todos"}
        onChange={(e) => actualizarParam("vigencia", e.target.value)}
      >
        <option value="todos">Vigencia: Todas</option>
        <option value="vigente">Vigentes</option>
        <option value="vencido">Vencidos</option>
      </Select>

      <Select
        className="w-full sm:w-56"
        value={searchParams.get("tipoContrato") ?? "todos"}
        onChange={(e) => actualizarParam("tipoContrato", e.target.value)}
      >
        <option value="todos">Tipo de contratación: Todos</option>
        {tiposContrato.map((t) => (
          <option key={t.valor} value={t.valor}>
            {t.etiqueta} ({t.cantidad})
          </option>
        ))}
      </Select>

      {hayFiltrosActivos ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setBusqueda("");
            startTransition(() => router.push(pathname));
          }}
        >
          <X className="h-4 w-4" /> Limpiar filtros
        </Button>
      ) : null}
    </div>
  );
}
