"use client";

import Link from "next/link";
import ChevronLeft from "lucide-react/icons/chevron-left";
import ChevronRight from "lucide-react/icons/chevron-right";

import { Button } from "@/components/ui/button";

interface PaginacionProps {
  page: number;
  totalPaginas: number;
  total: number;
  pageSize: number;
  /**
   * Modo enlace (Server Component padre, ej. listado de contratos).
   * Se pasan solo datos serializables (ruta base + params planos) en vez de
   * una función — un Server Component NO puede pasar funciones a un Client
   * Component (no son serializables por el RSC boundary salvo que sean
   * Server Actions con "use server"). El href final se arma aquí, en cliente.
   */
  baseHref?: string;
  queryParams?: Record<string, string>;
  /** Modo callback (estado en cliente, ej. pestañas del detalle de contrato). */
  onPageChange?: (page: number) => void;
  cargando?: boolean;
}

function construirHref(baseHref: string, queryParams: Record<string, string> | undefined, page: number): string {
  const params = new URLSearchParams(queryParams ?? {});
  params.set("page", String(page));
  return `${baseHref}?${params.toString()}`;
}

/**
 * Control de paginación reutilizable en todo el módulo de Tarifarios.
 * Soporta dos modos: navegación por URL (Link, para páginas server-rendered
 * con searchParams) o navegación por estado en cliente (callback, para las
 * pestañas del detalle que no deben recargar la página completa).
 */
export function Paginacion({ page, totalPaginas, total, pageSize, baseHref, queryParams, onPageChange, cargando }: PaginacionProps) {
  const desde = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const hasta = Math.min(page * pageSize, total);

  const puedeAnterior = page > 1;
  const puedeSiguiente = page < totalPaginas;

  const BotonAnterior = () =>
    baseHref ? (
      <Button variant="outline" size="sm" asChild disabled={!puedeAnterior}>
        <Link href={construirHref(baseHref, queryParams, page - 1)} aria-disabled={!puedeAnterior}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </Link>
      </Button>
    ) : (
      <Button variant="outline" size="sm" disabled={!puedeAnterior || cargando} onClick={() => onPageChange?.(page - 1)}>
        <ChevronLeft className="h-4 w-4" /> Anterior
      </Button>
    );

  const BotonSiguiente = () =>
    baseHref ? (
      <Button variant="outline" size="sm" asChild disabled={!puedeSiguiente}>
        <Link href={construirHref(baseHref, queryParams, page + 1)} aria-disabled={!puedeSiguiente}>
          Siguiente <ChevronRight className="h-4 w-4" />
        </Link>
      </Button>
    ) : (
      <Button variant="outline" size="sm" disabled={!puedeSiguiente || cargando} onClick={() => onPageChange?.(page + 1)}>
        Siguiente <ChevronRight className="h-4 w-4" />
      </Button>
    );

  return (
    <div className="flex flex-col items-center justify-between gap-2 py-3 sm:flex-row">
      <p className="text-xs text-muted-foreground">
        {total === 0 ? "Sin registros" : `Mostrando ${desde}–${hasta} de ${total.toLocaleString("es-CO")} registros`}
        {cargando ? " · Cargando…" : ""}
      </p>
      <div className="flex items-center gap-2">
        <BotonAnterior />
        <span className="text-xs text-muted-foreground">
          Página {page} de {totalPaginas}
        </span>
        <BotonSiguiente />
      </div>
    </div>
  );
}
