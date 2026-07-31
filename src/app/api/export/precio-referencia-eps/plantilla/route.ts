import { NextResponse } from "next/server";

import { obtenerCatalogoMunicipios } from "@/app/actions/precio-referencia-eps-actions";
import { crearLibroExcel, agregarHojaExcel, type ColumnaExportable } from "@/lib/negociacion/exportar";

/**
 * Plantilla descargable del módulo "Precios de Referencia EPS" (pedido por
 * el usuario 2026-07-31: "que me permita descargar la hoja de excel con el
 * formato para subir el archivo así el operador no tendrá que memorizar la
 * estructura, solo bajar la hoja y a alimentarla").
 *
 * `GET` sin parámetros — a diferencia de los demás exports del proyecto
 * (que dependen del resultado de un análisis), esta plantilla es siempre la
 * misma estructura fija; solo la hoja "Municipios válidos" es dinámica
 * (consulta en vivo el catálogo DANE para que el operador escriba el nombre
 * EXACTO que el parser va a poder resolver — ver `resolverMunicipioPorNombre`
 * en precio-referencia-eps-actions.ts, que rechaza nombres ambiguos o no
 * encontrados en vez de adivinar).
 *
 * Los encabezados de la hoja "Plantilla" son EXACTAMENTE los que el parser
 * (`precio-referencia-eps-parser.ts`) reconoce sin ambigüedad — si se
 * cambian aquí, deben seguir siendo detectables por `resolverColumnas`.
 */

interface FilaPlantilla {
  Nit_prestador: string;
  Prestador: string;
  Municipio: string;
  Codigo: string;
  Descripcion: string;
  Precio: number | string;
}

const COLUMNAS_PLANTILLA: ColumnaExportable<FilaPlantilla>[] = [
  { header: "Nit_prestador", valor: (f) => f.Nit_prestador, anchoExcel: 16 },
  { header: "Prestador", valor: (f) => f.Prestador, anchoExcel: 30 },
  { header: "Municipio", valor: (f) => f.Municipio, anchoExcel: 20 },
  { header: "Codigo", valor: (f) => f.Codigo, anchoExcel: 16 },
  { header: "Descripcion", valor: (f) => f.Descripcion, anchoExcel: 55 },
  { header: "Precio", valor: (f) => f.Precio, anchoExcel: 14 },
];

// Mismos datos de ejemplo que trajo el usuario en su pedido original —
// reconocibles para quien ya conoce el archivo, y claramente marcados como
// EJEMPLO en la hoja de instrucciones para que se borren antes de cargar.
const FILAS_EJEMPLO: FilaPlantilla[] = [
  { Nit_prestador: "900935126", Prestador: "Asmet Salud EPS", Municipio: "Valledupar", Codigo: "20067147-2", Descripcion: "(Xarelto) Rivaroxaban Tableta 2.5mg - Bayer", Precio: 4586 },
  { Nit_prestador: "900935126", Prestador: "Asmet Salud EPS", Municipio: "Valledupar", Codigo: "19979154-1", Descripcion: "100mg Tableta Quetiapina (Tiamax) - Scandinavia", Precio: 2390 },
];

const COLUMNAS_MUNICIPIOS: ColumnaExportable<{ Municipio: string; Departamento: string }>[] = [
  { header: "Municipio", valor: (f) => f.Municipio, anchoExcel: 30 },
  { header: "Departamento", valor: (f) => f.Departamento, anchoExcel: 25 },
];

export async function GET() {
  try {
    // La hoja "Municipios válidos" es un extra de conveniencia — si la
    // consulta al catálogo falla (ej. proxy de BD caído), la plantilla se
    // sigue generando igual (Instrucciones + Plantilla), solo sin esa hoja.
    let municipios: { municipioNombre: string; departamentoNombre: string }[] = [];
    try {
      municipios = await obtenerCatalogoMunicipios();
    } catch (error) {
      console.warn("[export/precio-referencia-eps/plantilla] No fue posible cargar el catálogo de municipios:", error);
    }

    const filasParametros = [
      { Instrucción: "1. Columnas requeridas", Detalle: "Nit_prestador, Prestador, Municipio, Codigo, Descripcion, Precio (los nombres pueden variar un poco — el sistema tolera acentos/mayúsculas/espacios — pero no borre ni renombre las columnas)." },
      { Instrucción: "2. Nit_prestador / Prestador", Detalle: "NIT y razón social de la EPS/entidad que reporta el precio — NO es un prestador/IPS de Dusakawi." },
      { Instrucción: "3. Municipio", Detalle: 'Escriba el nombre EXACTO del municipio (ver hoja "Municipios válidos"). Si el nombre no se reconoce o existe en más de un departamento, esa fila no se cargará.' },
      { Instrucción: "4. Codigo / Descripcion", Detalle: "Código CUPS/CUM/insumo y su descripción, tal como los reporta la EPS de origen." },
      { Instrucción: "5. Precio", Detalle: "Solo el número (con o sin separador de miles). No incluya el símbolo $." },
      { Instrucción: "6. Filas de ejemplo", Detalle: 'La hoja "Plantilla" trae 2 filas de ejemplo — BÓRRELAS antes de cargar sus datos reales, o el sistema las cargará también.' },
      { Instrucción: "7. Cómo cargar", Detalle: 'Guarde este archivo y súbalo en "Precios de Referencia de Otras EPS" → "Cargar archivo". Puede repetir la carga las veces que necesite: actualiza el precio si ya existía la misma combinación EPS + municipio + código.' },
    ];

    const filasMunicipios = municipios.map((m) => ({ Municipio: m.municipioNombre, Departamento: m.departamentoNombre }));

    const workbook = crearLibroExcel();
    agregarHojaExcel(
      workbook,
      filasParametros,
      [
        { header: "Instrucción", valor: (f) => f.Instrucción, anchoExcel: 28 },
        { header: "Detalle", valor: (f) => f.Detalle, anchoExcel: 90 },
      ],
      "Instrucciones"
    );
    agregarHojaExcel(workbook, FILAS_EJEMPLO, COLUMNAS_PLANTILLA, "Plantilla");
    agregarHojaExcel(workbook, filasMunicipios, COLUMNAS_MUNICIPIOS, "Municipios válidos");

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="Plantilla_Precios_Referencia_EPS.xlsx"',
      },
    });
  } catch (error) {
    console.error("[export/precio-referencia-eps/plantilla] Error generando la plantilla:", error);
    return NextResponse.json({ error: "No fue posible generar la plantilla." }, { status: 500 });
  }
}
