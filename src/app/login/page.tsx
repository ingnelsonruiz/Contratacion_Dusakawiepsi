import { Suspense } from "react";
import { LoginForm } from "./login-form";
import ShieldCheck from "lucide-react/icons/shield-check";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-extrabold text-primary tracking-tight">
            Inteligencia de Precios
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Negociación de Contratos · Área de Contratación · DUSAKAWI EPSI
          </p>
        </div>

        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Acceso exclusivo para personal autorizado del Área de Contratación.
        </p>
      </div>
    </div>
  );
}
