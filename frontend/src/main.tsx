import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"

import { router } from "@/routes"
import { queryClient } from "@/lib/query-client"
import { AuthProvider } from "@/lib/auth-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
)
