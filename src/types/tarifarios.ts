/**
 * Tipos del Módulo 1 — Tarifario Vigente e Histórico.
 *
 * Reflejan el esquema REAL verificado en administrativo.ct_ips_contrato,
 * ct_ips, tb_tarifario_propio_encabezado/_detalle (MCP Postgres, solo lectura,
 * 2026-07-28). No inventar columnas nuevas sin volver a verificar contra la BD.
 */

export type TipoTarifario = "servicios" | "medicamentos" | "insumos" | "paquetes" | "otros";

export interface OpcionFiltro {
  valor: string;
  etiqueta: string;
  cantidad?: number;
}

/** Filtros del listado de contratos (Server Action listContratos). */
export interface FiltrosContrato {
  busqueda?: string; // razón social, NIT o número de contrato
  estado?: number;
  tipoContrato?: number;
  vigencia?: "vigente" | "vencido" | "todos";
  page: number;
  pageSize: number;
}

/** Fila del listado de contratos. */
export interface ContratoListado {
  consecutivoContrato: number;
  numeroContrato: string;
  ips: number;
  razonSocial: string;
  nit: string;
  codigoHabilitacion: string | null;
  fechaInicio: string;
  fechaTerminacion: string;
  estado: number;
  valorContrato: number;
  tipoContrato: number | null;
  tipoContratoDescripcion: string | null;
  modalidadContrato: number | null;
  modalidadDescripcion: string | null;
  tieneServicios: boolean;
  tieneMedicamentos: boolean;
  tieneInsumos: boolean;
  vigente: boolean;
}

/** Resumen completo del contrato (encabezado de la página de detalle). */
export interface ContratoDetalle extends ContratoListado {
  numeroAfiliados: number;
  fechaSuscripcion: string;
  valorMes: number;
  porcentajeUpc: number;
  valorPercapita: number | null;
  nombreResponsableContratacion: string | null;
  observacion: string | null;
  montoEjecutado: number;
  montoAcumuladoAutorizaciones: number;
  consecutivoTarifarioServicio: number | null;
  consecutivoTarifarioMedicamento: number | null;
  consecutivoTarifarioInsumo: number | null;
}

/** Fila de tarifario — Procedimientos (CUPS) u Otros (sin CUPS). */
export interface TarifaServicioRow {
  consecutivoTarifa: number;
  secuencia: number;
  codigoTarifa: string;
  codigoPropio: string;
  descripcion: string;
  valor: number;
  valorBase: number;
  valorPactado: number;
  valorRegulado: number;
  porcentajeTarifa: number;
  valorFinal: number; // resuelto por resolverValorFinal()
  swPaquete: boolean;
  swQuirurgico: boolean;
  swAmbulatorio: boolean;
  swHospitalario: boolean;
  swUrgencia: boolean;
  consecutivoCup: number | null;
  cupCodigoInterno: string | null;
  cupDescripcion: string | null;
}

/** Fila de tarifario — Medicamentos (CUM). */
export interface TarifaMedicamentoRow {
  consecutivoTarifa: number;
  secuencia: number;
  codigoTarifa: string;
  codigoPropio: string;
  descripcion: string;
  valor: number;
  valorBase: number;
  valorPactado: number;
  valorRegulado: number;
  porcentajeTarifa: number;
  valorFinal: number;
  swPaquete: boolean;
  consecutivoMedicamento: number | null;
  cum: string | null; // tb_medicamento.codigo_interno
  nombreComercial: string | null;
  principioActivo: string | null;
  presentacion: string | null; // forma_farmaceutica + concentracion
  laboratorio: string | null; // tb_marca_medicamento.descripcion
  unidad: string | null; // tb_unidad_medida.descripcion
}

/** Fila de tarifario — Insumos. */
export interface TarifaInsumoRow {
  consecutivoTarifa: number;
  secuencia: number;
  codigoTarifa: string;
  codigoPropio: string;
  descripcion: string;
  valor: number;
  valorBase: number;
  valorPactado: number;
  valorRegulado: number;
  porcentajeTarifa: number;
  valorFinal: number;
  swPaquete: boolean;
  consecutivoInsumo: number | null;
  insumoCodigoInterno: string | null;
  insumoDescripcion: string | null;
  unidad: string | null;
}

/** Fila de tarifario — Paquetes (cruce de servicios/medicamentos/insumos marcados como paquete). */
export interface TarifaPaqueteRow {
  origen: "servicios" | "medicamentos" | "insumos";
  consecutivoTarifa: number;
  codigoTarifa: string;
  codigoPropio: string;
  codigoPaquete: string | null;
  descripcion: string;
  valor: number;
  valorFinal: number;
}

export interface ParametrosBusquedaTarifario {
  busqueda?: string;
  page: number;
  pageSize: number;
}

export interface ResultadoPaginado<T> {
  filas: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}

/** Conteos por pestaña — para decidir cuáles mostrar ("si existen" / "si aplica"). */
export interface ConteosTarifario {
  servicios: number;
  otros: number;
  medicamentos: number;
  insumos: number;
  paquetes: number;
}
