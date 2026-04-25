import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"

import { router } from "@/routes"
import { queryClient } from "@/lib/query-client"
import { AuthProvider } from "@/lib/auth-provider"
import { ErrorBoundary } from "@/components/shared/ErrorBoundary"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delayDuration={200}>
            <RouterProvider router={router} />
            <Toaster
              position="bottom-right"
              richColors
              closeButton
              toastOptions={{
                // Mantem visual coerente com o resto: rounded-card, border-l do erro
                classNames: {
                  toast:
                    "rounded-card border border-border bg-surface text-foreground shadow-2",
                  description: "text-muted",
                  error:
                    "border-l-4 border-erro text-erro [&_[data-icon]]:text-erro",
                  success:
                    "border-l-4 border-sucesso text-sucesso [&_[data-icon]]:text-sucesso",
                },
              }}
            />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
