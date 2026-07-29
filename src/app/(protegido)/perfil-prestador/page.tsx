import UserSearch from "lucide-react/icons/user-search";

import { PerfilPrestadorClient } from "@/components/perfil-prestador/perfil-prestador-client";

export const dynamic = "force-dynamic";

export default function PerfilPrestadorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <UserSearch className="h-6 w-6 text-primary" /> Perfil Competitivo del Prestador
        </h1>
        <p className="text-sm text-muted-foreground">
          Analiza UN solo prestador contra sus pares del <strong>mismo municipio</strong>, en todos los municipios
          donde opera: score de riesgo, códigos críticos/alerta y el detalle completo código por código.
        </p>
      </div>

      <PerfilPrestadorClient />
    </div>
  );
}
