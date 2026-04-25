import { useEffect, useState } from "react"
import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { Topbar } from "./Topbar"

/**
 * Layout das rotas autenticadas.
 *
 * Desktop (>=md): Sidebar fixa de 240px à esquerda + Topbar 54px + conteudo.
 * Mobile (<md):   Sidebar vira drawer overlay; Topbar ganha botao hambúrguer.
 *
 * O estado mobile-open vive aqui (não na Topbar) pra que a Sidebar possa
 * fechar sozinha ao navegar — o `useLocation` dispara o `useEffect` quando
 * a rota muda.
 */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // O drawer fecha quando o usuario clica num link (SidebarLink usa o
  // onNavigate prop). Nao precisa de useEffect espiando o pathname —
  // evita o lint react-hooks/set-state-in-effect.

  // Bloqueia scroll do body quando o drawer esta aberto. Side-effect no
  // DOM, sem setState — eh exatamente o caso pra useEffect existir.
  useEffect(() => {
    if (typeof document === "undefined") return
    document.body.style.overflow = mobileNavOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [mobileNavOpen])

  return (
    <div className="flex min-h-screen flex-col bg-background md:grid md:grid-cols-[240px_1fr] md:flex-row">
      {/* Sidebar desktop (>= md) */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Sidebar mobile drawer (< md) */}
      {mobileNavOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-roxo-profundo/60 backdrop-blur-sm md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Fechar menu"
            role="button"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 w-[260px] shadow-elev md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
          >
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main id="main" className="flex-1 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
