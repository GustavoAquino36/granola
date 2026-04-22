import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/lib/auth-context"

/**
 * Envolve as rotas que exigem sessao ativa.
 * - Enquanto /api/auth/me resolve, renderiza um estado neutro pra evitar flash.
 * - Sem sessao -> redireciona para /login com ?next=<path-atual>.
 * - Com sessao -> libera <Outlet />.
 */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="grid min-h-screen place-items-center bg-background"
      >
        <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted">
          verificando sessao…
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return <Outlet />
}
