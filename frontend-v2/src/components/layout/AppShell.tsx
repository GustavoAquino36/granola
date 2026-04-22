import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { Topbar } from "./Topbar"

/**
 * Layout das rotas autenticadas.
 * Sidebar 240px Roxo Granola + Topbar 54px Surface + conteudo com Outlet.
 *
 * A partir do Commit 4, este componente passa a ser renderizado dentro de um
 * ProtectedRoute — rotas aqui dentro exigem autenticacao.
 */
export function AppShell() {
  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-col">
        <Topbar />
        <main id="main" className="flex-1 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
