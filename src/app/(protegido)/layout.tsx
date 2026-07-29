import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
import ShieldCheck from "lucide-react/icons/shield-check";

export default async function ProtegidoLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // Defensa en profundidad: el middleware ya protege estas rutas, pero un
  // Server Component nunca debe asumir que el request pasó por middleware
  // (ej. llamadas directas en pruebas, cambios futuros de matcher).
  if (!session) {
    redirect("/login");
  }

  const rolLabel: Record<string, string> = {
    analista: "Analista de Contratación",
    jefe_contratacion: "Jefe de Contratación",
    admin: "Administrador",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <p className="text-sm font-bold leading-none text-primary">Inteligencia de Precios</p>
              <p className="text-[11px] leading-none text-muted-foreground">Negociación de Contratos · DUSAKAWI EPSI</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold leading-none">{session.nombreCompleto}</p>
              <p className="text-[11px] leading-none text-muted-foreground">{rolLabel[session.rol] ?? session.rol}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
