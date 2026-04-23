import { useMemo } from "react"
import { Link } from "react-router-dom"
import { Download, Plus } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { AlertasCard } from "@/components/features/agora/AlertasCard"
import { AtividadeRecenteCard } from "@/components/features/agora/AtividadeRecenteCard"
import { KpiGrid } from "@/components/features/agora/KpiGrid"
import { ProximosPrazosCard } from "@/components/features/agora/ProximosPrazosCard"
import { cn } from "@/lib/utils"

/** Retorna "Bom dia" / "Boa tarde" / "Boa noite" conforme a hora local. */
function greetingFor(hour: number): string {
  if (hour < 12) return "Bom dia"
  if (hour < 18) return "Boa tarde"
  return "Boa noite"
}

/** Capitaliza a primeira letra de uma string (sem mexer no resto). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function AgoraPage() {
  const { user } = useAuth()
  const now = useMemo(() => new Date(), [])
  const greeting = greetingFor(now.getHours())
  const name = user?.display_name ?? "Usuario"

  const formattedDate = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    return capitalize(fmt.format(now))
  }, [now])

  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
      {/* ================= HERO ================= */}
      <header className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-4xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            {greeting},{" "}
            <em className="not-italic font-normal text-dourado italic">
              {name}.
            </em>
          </h1>
          <p className="font-display mt-1.5 text-lg italic text-muted">
            {formattedDate} · sua area de trabalho do dia.
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-card border border-border-strong bg-transparent px-4 py-2.5",
              "font-sans text-sm font-semibold text-foreground transition-all duration-[180ms]",
              "hover:border-dourado hover:bg-dourado/8"
            )}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            Exportar
          </button>

          <Link
            to="/clientes"
            className={cn(
              "flex items-center gap-1.5 rounded-card bg-dourado px-4 py-2.5",
              "font-sans text-sm font-semibold text-tinta transition-all duration-[180ms]",
              "hover:bg-dourado-claro hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]",
              "active:translate-y-px"
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Adicionar cliente
          </Link>
        </div>
      </header>

      {/* ================= FILETE ================= */}
      <div className="mb-8 h-px w-full bg-hairline" aria-hidden />

      {/* ================= KPIs ================= */}
      <KpiGrid />

      {/* ================= GRID PRINCIPAL ================= */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <ProximosPrazosCard />
        <AlertasCard />
      </div>

      {/* ================= GRID SECUNDARIO ================= */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <AtividadeRecenteCard />
        {/* Mini calendario entra no proximo commit */}
        <div className="rounded-card border border-dashed border-border bg-surface-alt p-5 text-[0.8125rem] text-muted">
          <p className="font-sans text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted">
            em construcao
          </p>
          <p className="mt-2">Calendario mini do mes corrente com marcadores de compromissos e prazos fatais.</p>
        </div>
      </div>

      {/* ================= DEBUG ================= */}
      {import.meta.env.DEV && (
        <p className="mt-8 text-center font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted/60">
          dev · logado como {user?.username} ({user?.role})
        </p>
      )}
    </div>
  )
}
