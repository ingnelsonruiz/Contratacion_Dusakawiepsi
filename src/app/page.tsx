import Link from "next/link";
import { Button } from "@/components/ui/button";
import ShieldCheck from "lucide-react/icons/shield-check";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-4 text-center">
      <ShieldCheck className="h-14 w-14 text-primary" />
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-primary">
          Sistema de Inteligencia de Precios
        </h1>
        <p className="mt-2 text-muted-foreground max-w-md mx-auto">
          Negociación de Contratos · Área de Contratación · DUSAKAWI EPSI
        </p>
      </div>
      <Button asChild size="lg">
        <Link href="/login">Ingresar</Link>
      </Button>
    </div>
  );
}
