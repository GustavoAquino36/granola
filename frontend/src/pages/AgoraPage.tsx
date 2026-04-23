import { useMemo } from "react"
import { Link } from "react-router-dom"
import { Download, Plus } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
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
      <div className="mb-10 h-px w-full bg-hairline" aria-hidden />

      {/* ================= PLACEHOLDER HONESTO ================= */}
      <section
        aria-labelledby="proxima-entrega"
        className="rounded-card border border-border bg-surface p-8 shadow-1"
      >
        <p className="font-sans text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-dourado">
          Próxima entrega · Fase 2
        </p>
        <h2
          id="proxima-entrega"
          className="font-display mt-2 text-2xl font-normal text-foreground"
        >
          O que vai aparecer aqui, em ordem.
        </h2>
        <ul className="mt-6 grid gap-3 text-sm text-muted md:grid-cols-2">
          <ChecklistItem title="KPIs do dia" desc="prazos esta semana, processos ativos, clientes, a receber 30d" />
          <ChecklistItem title="Próximos prazos" desc="tabela filtravel com CNJ, cliente, tipo, vencimento, status (fatal/alerta/ok)" />
          <ChecklistItem title="Alertas" desc="prazos fatais, sincronizacoes pendentes, backup concluido" />
          <ChecklistItem title="Atividade recente" desc="timeline de movimentacoes do dia vindas de DataJud, DJEN e acoes manuais" />
          <ChecklistItem title="Calendário mini" desc="mes corrente com marcadores de eventos e prazos fatais" />
          <ChecklistItem
            title="Atalhos e busca Cmd+K"
            desc="busca unificada processo/cliente/peça, atalhos do Brandbook Cap. 23"
          />
        </ul>

        <p className="mt-8 border-t border-border pt-5 font-mono text-xs text-muted/80">
          o backend ja expõe os endpoints /api/granola/stats, /publicacoes-datajud/status, /prazos, /movimentacoes.
          <br />
          falta ligar os hooks TanStack Query (em progresso).
        </p>
      </section>

      {/* ================= DEBUG CONTEXT ================= */}
      {import.meta.env.DEV && (
        <p className="mt-8 text-center font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted/60">
          dev · logado como {user?.username} ({user?.role})
        </p>
      )}
    </div>
  )
}

function ChecklistItem({ title, desc }: { title: string; desc: string }) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-dourado/70"
        aria-hidden
      />
      <div className="min-w-0">
        <div className="font-sans text-sm font-medium text-foreground">
          {title}
        </div>
        <div className="mt-0.5 font-sans text-[0.8125rem] text-muted">
          {desc}
        </div>
      </div>
    </li>
  )
}
