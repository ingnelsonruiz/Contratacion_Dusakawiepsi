import * as React from "react";
import ChevronDown from "lucide-react/icons/chevron-down";

import { cn } from "@/lib/utils";

/**
 * Select nativo (HTML <select>) con la misma piel visual del resto de
 * componentes Shadcn del proyecto. Se evita @radix-ui/react-select
 * deliberadamente para no sumar una dependencia nueva más allá de las ya
 * agregadas (@radix-ui/react-tabs, exceljs) — un <select> nativo cubre el
 * caso de uso de filtros (una opción a la vez, sin búsqueda ni multi-select).
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
);
Select.displayName = "Select";

export { Select };
