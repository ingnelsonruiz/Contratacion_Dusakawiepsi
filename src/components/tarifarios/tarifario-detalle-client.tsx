"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TablaTarifario } from "@/components/tarifarios/tabla-tarifario";
import {
  getTarifarioServicios,
  getTarifarioMedicamentos,
  getTarifarioInsumos,
  getTarifarioPaquetes,
  getTarifarioOtros,
} from "@/app/actions/tarifario-actions";
import { formatearMoneda } from "@/lib/negociacion/formato";
import type { ConteosTarifario } from "@/types/tarifarios";

interface TarifarioDetalleClientProps {
  consecutivoContrato: number;
  conteos: ConteosTarifario;
}

/**
 * Orquesta las pestañas del detalle de contrato. Procedimientos, Medicamentos
 * e Insumos son las 3 pestañas fijas del módulo (spec original: sin
 * calificador "si existen") y SIEMPRE se muestran, incluso en 0 — así el
 * analista ve explícitamente que ARYUWIS no tiene ese tarifario cargado para
 * el contrato, en vez de que la pestaña desaparezca (que parece un error del
 * sistema). Paquetes y Otros sí son condicionales ("si existen"/"si aplica")
 * porque no todo contrato tiene paquetes negociados ni ítems sin CUPS.
 * La navegación entre pestañas es 100% en cliente (Radix Tabs) — no hay
 * recarga de página al cambiar de pestaña, cambiar de página de resultados
 * o buscar dentro de una pestaña.
 */
export function TarifarioDetalleClient({ consecutivoContrato, conteos }: TarifarioDetalleClientProps) {
  return (
    <Tabs defaultValue="servicios">
      <TabsList>
        <TabsTrigger value="servicios">Procedimientos ({conteos.servicios})</TabsTrigger>
        <TabsTrigger value="medicamentos">Medicamentos ({conteos.medicamentos})</TabsTrigger>
        <TabsTrigger value="insumos">Insumos ({conteos.insumos})</TabsTrigger>
        {conteos.paquetes > 0 && <TabsTrigger value="paquetes">Paquetes ({conteos.paquetes})</TabsTrigger>}
        {conteos.otros > 0 && <TabsTrigger value="otros">Otros ({conteos.otros})</TabsTrigger>}
      </TabsList>

      <TabsContent value="servicios">
        {conteos.servicios === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Este contrato no tiene tarifario de procedimientos (CUPS) cargado en ARYUWIS.
          </p>
        ) : (
          <TablaTarifario
            consecutivoContrato={consecutivoContrato}
            tipo="servicios"
            cargarPagina={getTarifarioServicios}
            claveFila={(f) => `${f.consecutivoTarifa}-${f.secuencia}`}
            placeholderBusqueda="Buscar por CUPS o descripción…"
            tituloExport="Procedimientos"
            columnas={[
              { header: "Código CUPS", render: (f) => f.cupCodigoInterno ?? f.codigoPropio },
              { header: "Descripción", render: (f) => f.descripcion, className: "max-w-md" },
              { header: "Tarifa contratada", render: (f) => f.codigoTarifa },
              { header: "Valor final", render: (f) => formatearMoneda(f.valorFinal), className: "text-right font-medium" },
              { header: "Observaciones", render: () => "—" },
            ]}
          />
        )}
      </TabsContent>

      <TabsContent value="medicamentos">
        {conteos.medicamentos === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Este contrato no tiene tarifario de medicamentos (CUM) cargado en ARYUWIS.
          </p>
        ) : (
          <TablaTarifario
            consecutivoContrato={consecutivoContrato}
            tipo="medicamentos"
            cargarPagina={getTarifarioMedicamentos}
            claveFila={(f) => `${f.consecutivoTarifa}-${f.secuencia}`}
            placeholderBusqueda="Buscar por CUM, nombre o laboratorio…"
            tituloExport="Medicamentos"
            columnas={[
              { header: "Código CUM", render: (f) => f.cum ?? f.codigoPropio },
              // No existe columna de código IUM asociada al maestro de
              // medicamentos en este esquema (verificado 2026-07-28) — el
              // IUM vive en el módulo tarifario legado de ARYUWIS
              // (herramienta "ium-tariff-validator" de Proyecto_Dusakawi),
              // no en tb_medicamento. Se muestra "—" en vez de fabricar dato.
              { header: "Código IUM", render: () => "—" },
              { header: "Nombre comercial", render: (f) => f.nombreComercial ?? f.descripcion, className: "max-w-xs" },
              { header: "Principio activo", render: (f) => f.principioActivo ?? "—" },
              { header: "Presentación", render: (f) => f.presentacion ?? "—" },
              { header: "Laboratorio", render: (f) => f.laboratorio ?? "—" },
              { header: "Valor contratado", render: (f) => formatearMoneda(f.valorFinal), className: "text-right font-medium" },
              { header: "Unidad", render: (f) => f.unidad ?? "—" },
              { header: "Observaciones", render: () => "—" },
            ]}
          />
        )}
      </TabsContent>

      <TabsContent value="insumos">
        {conteos.insumos === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Este contrato no tiene tarifario de insumos cargado en ARYUWIS.
          </p>
        ) : (
          <TablaTarifario
            consecutivoContrato={consecutivoContrato}
            tipo="insumos"
            cargarPagina={getTarifarioInsumos}
            claveFila={(f) => `${f.consecutivoTarifa}-${f.secuencia}`}
            placeholderBusqueda="Buscar por código o descripción…"
            tituloExport="Insumos"
            columnas={[
              { header: "Código interno", render: (f) => f.insumoCodigoInterno ?? f.codigoPropio },
              { header: "Descripción", render: (f) => f.insumoDescripcion ?? f.descripcion, className: "max-w-md" },
              { header: "Unidad", render: (f) => f.unidad ?? "—" },
              { header: "Valor contratado", render: (f) => formatearMoneda(f.valorFinal), className: "text-right font-medium" },
              { header: "Observaciones", render: () => "—" },
            ]}
          />
        )}
      </TabsContent>

      {conteos.paquetes > 0 && (
        <TabsContent value="paquetes">
          <TablaTarifario
            consecutivoContrato={consecutivoContrato}
            tipo="paquetes"
            cargarPagina={getTarifarioPaquetes}
            claveFila={(f) => `${f.origen}-${f.consecutivoTarifa}-${f.codigoTarifa}`}
            placeholderBusqueda="Buscar paquete…"
            tituloExport="Paquetes"
            columnas={[
              { header: "Origen", render: (f) => f.origen },
              { header: "Código paquete", render: (f) => f.codigoPaquete ?? f.codigoTarifa },
              { header: "Código propio", render: (f) => f.codigoPropio },
              { header: "Descripción", render: (f) => f.descripcion, className: "max-w-md" },
              { header: "Valor final", render: (f) => formatearMoneda(f.valorFinal), className: "text-right font-medium" },
            ]}
          />
        </TabsContent>
      )}

      {conteos.otros > 0 && (
        <TabsContent value="otros">
          <TablaTarifario
            consecutivoContrato={consecutivoContrato}
            tipo="otros"
            cargarPagina={getTarifarioOtros}
            claveFila={(f) => `${f.consecutivoTarifa}-${f.secuencia}`}
            placeholderBusqueda="Buscar ítem negociado…"
            tituloExport="Otros"
            columnas={[
              { header: "Código propio", render: (f) => f.codigoPropio },
              { header: "Descripción", render: (f) => f.descripcion, className: "max-w-md" },
              { header: "Tarifa contratada", render: (f) => f.codigoTarifa },
              { header: "Valor final", render: (f) => formatearMoneda(f.valorFinal), className: "text-right font-medium" },
              { header: "Observaciones", render: () => "—" },
            ]}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
