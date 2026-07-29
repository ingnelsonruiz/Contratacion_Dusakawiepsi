import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/auth";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import Scale from "lucide-react/icons/scale";
import History from "lucide-react/icons/history";
import UserSearch from "lucide-react/icons/user-search";
import Activity from "lucide-react/icons/activity";
import TrendingDown from "lucide-react/icons/trending-down";
import FlaskConical from "lucide-react/icons/flask-conical";
import Globe from "lucide-react/icons/globe";

const MODULOS = [
  {
    icono: FileSpreadsheet,
    titulo: "Tarifario Vigente e Histórico",
    descripcion: "Tarifario contratado por prestador/contrato, con pestañas de Procedimientos, Medicamentos, Insumos y Paquetes.",
    estado: "Disponible",
    href: "/tarifarios",
  },
  {
    icono: Scale,
    titulo: "Comparativo entre Prestadores",
    descripcion: "Comparación estadística de tarifas de un mismo CUPS/CUM/Insumo entre prestadores del mismo municipio.",
    estado: "Disponible",
    href: "/comparativo",
  },
  {
    icono: History,
    titulo: "Comparativo Histórico del Prestador",
    descripcion: "Evolución de la tarifa negociada con un mismo prestador: foto 2025 vs. valor vigente hoy, por código.",
    estado: "Disponible",
    href: "/historico-prestador",
  },
  {
    icono: UserSearch,
    titulo: "Perfil Competitivo del Prestador",
    descripcion: "Analiza UN prestador contra sus pares del mismo municipio: score de riesgo, posición en el ranking y detalle código por código.",
    estado: "Disponible",
    href: "/perfil-prestador",
  },
  {
    icono: Activity,
    titulo: "Consumo y Frecuencia",
    descripcion: "Consumo real facturado (RIPS) agregado por prestador, código y período.",
    estado: "Disponible",
    href: "/consumo-frecuencia",
  },
  {
    icono: TrendingDown,
    titulo: "Sobrecostos y Ahorro",
    descripcion: "Detección de variaciones críticas e impacto financiero estimado.",
    estado: "Próximamente",
  },
  {
    icono: FlaskConical,
    titulo: "Simulador de Escenarios",
    descripcion: "Proyección de impacto de una tarifa propuesta antes de negociar.",
    estado: "Próximamente",
  },
  {
    icono: Globe,
    titulo: "Benchmark de Mercado Externo",
    descripcion: "Referencia de precios externa (SISMED / datos.gov.co).",
    estado: "Fase 6",
  },
];

export default async function DashboardPage() {
  const session = await getSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Panel de Contratación</h1>
        <p className="text-sm text-muted-foreground">
          Bienvenido{session ? `, ${session.nombreCompleto}` : ""}. Módulo 1 (Tarifario Vigente e Histórico) disponible
          con datos en vivo de ARYUWIS. Los demás módulos de análisis se habilitarán fase por fase.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULOS.map((mod) => {
          const Icono = mod.icono;
          const disponible = mod.estado === "Disponible" && mod.href;

          const contenido = (
            <Card key={mod.titulo} className={disponible ? "transition-colors hover:border-primary" : "border-dashed"}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Icono className="h-6 w-6 text-primary" />
                  <Badge
                    variant={disponible ? "default" : "outline"}
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {mod.estado}
                  </Badge>
                </div>
                <CardTitle className="text-base">{mod.titulo}</CardTitle>
                <CardDescription>{mod.descripcion}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          );

          return disponible ? (
            <Link key={mod.titulo} href={mod.href!}>
              {contenido}
            </Link>
          ) : (
            contenido
          );
        })}
      </div>
    </div>
  );
}
