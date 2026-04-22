import { Link, useLocation, useParams } from "react-router-dom"
import { Bell, Search } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Mapa de pathname-prefix -> label do breadcrumb.
 * Mantido proximo do router pra breadcrumb refletir a rota ativa.
 */
const LABELS: Record<string, string> = {
  "/agora": "Agora",
  "/clientes": "Clientes",
  "/processos": "Processos",
  "/agenda": "Agenda",
  "/financeiro": "Financeiro",
  "/modelos": "Modelos",
  "/config": "Configurações",
}

export function Topbar() {
  const { pathname } = useLocation()
  const params = useParams()
  const segments = pathname.split("/").filter(Boolean)
  const base = "/" + (segments[0] ?? "")
  const baseLabel = LABELS[base] ?? "Início"
  // Se for /processos/:id, adiciona um segundo breadcrumb com o id.
  const hasDetail = Boolean(params.id)

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3.5 border-b border-border bg-surface px-[22px]">
      <Breadcrumb>
        <Link
          to="/agora"
          className="transition-colors hover:text-foreground"
        >
          Início
        </Link>
        <Sep />
        <span
          className={cn(
            hasDetail ? "text-muted" : "font-medium text-foreground"
          )}
        >
          {baseLabel}
        </span>
        {hasDetail && (
          <>
            <Sep />
            <span className="truncate font-mono text-foreground">
              #{params.id}
            </span>
          </>
        )}
      </Breadcrumb>

      <SearchBox />

      <IconButton label="Notificações">
        <Bell className="h-4 w-4" strokeWidth={1.75} />
      </IconButton>

      {/* Avatar — placeholder ate AuthContext entrar no Commit 4.
          Em producao as iniciais vem do user autenticado. */}
      <button
        type="button"
        aria-label="Menu do usuario"
        title="Dr. Claudio"
        className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-dourado font-sans text-xs font-bold text-tinta transition-transform duration-[180ms] hover:scale-105"
      >
        CV
      </button>
    </header>
  )
}

function Breadcrumb({ children }: { children: React.ReactNode }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-muted"
    >
      {children}
    </nav>
  )
}

function Sep() {
  return (
    <span className="select-none text-[0.7rem] text-dourado" aria-hidden>
      /
    </span>
  )
}

function SearchBox() {
  return (
    <div
      className={cn(
        "ml-auto flex w-[320px] items-center gap-2 rounded-pill border border-border bg-surface-alt px-3 py-1.5 text-muted transition-all duration-[180ms]",
        "focus-within:border-dourado focus-within:bg-surface focus-within:shadow-[0_0_0_3px_rgba(198,158,91,0.12)]"
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <input
        type="search"
        placeholder="Buscar processo, cliente, peça…"
        className="min-w-0 flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
      />
      <kbd className="rounded-[4px] border border-border bg-background px-1.5 py-px font-mono text-[0.7rem] text-muted">
        Ctrl K
      </kbd>
    </div>
  )
}

function IconButton({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-pill bg-transparent text-muted transition-colors duration-[180ms] hover:bg-dourado/10 hover:text-foreground"
    >
      {children}
    </button>
  )
}
