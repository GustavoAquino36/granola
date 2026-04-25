import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import {
  Bell,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  type LucideIcon,
} from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { initialsFrom } from "@/lib/format"
import { ChangePasswordDialog } from "@/components/features/admin/ChangePasswordDialog"

/**
 * Mapa pathname-prefix -> label do breadcrumb.
 * Mantido sincronizado com o router.
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

interface TopbarProps {
  /** Callback do botao hamburguer no mobile — handled pelo AppShell. */
  onOpenMobileNav?: () => void
}

export function Topbar({ onOpenMobileNav }: TopbarProps = {}) {
  const { pathname } = useLocation()
  const params = useParams()
  const segments = pathname.split("/").filter(Boolean)
  const base = "/" + (segments[0] ?? "")
  const baseLabel = LABELS[base] ?? "Início"
  const hasDetail = Boolean(params.id)

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:gap-3.5 sm:px-[22px]">
      {/* Botao hamburguer — so em mobile (<md) */}
      {onOpenMobileNav && (
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={onOpenMobileNav}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground md:hidden"
        >
          <Menu className="h-4.5 w-4.5" strokeWidth={1.75} />
        </button>
      )}

      <Breadcrumb>
        <Link
          to="/agora"
          className="hidden transition-colors hover:text-foreground sm:inline"
        >
          Início
        </Link>
        <span className="hidden sm:inline">
          <Sep />
        </span>
        <span className={cn(hasDetail ? "text-muted" : "font-medium text-foreground")}>
          {baseLabel}
        </span>
        {hasDetail && (
          <>
            <Sep />
            <span className="truncate font-mono text-foreground">#{params.id}</span>
          </>
        )}
      </Breadcrumb>

      {/* SearchBox so em desktop (lg+) — em mobile fica no menu hamburguer
          ou em pages especificas. Evita topbar entupido em <md. */}
      <SearchBox />

      <ThemeToggle />
      <IconButton label="Notificações" Icon={Bell} />

      <UserMenu />
    </header>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === "dark"
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={isDark ? "Tema escuro ativo" : "Tema claro ativo"}
      className="grid h-9 w-9 sm:h-8 sm:w-8 shrink-0 place-items-center rounded-pill bg-transparent text-muted transition-colors duration-[180ms] hover:bg-dourado/10 hover:text-foreground"
    >
      {isDark ? (
        <Sun className="h-4 w-4" strokeWidth={1.75} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  )
}

/* ========================================================================= */

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
        // Esconde em mobile pequeno (<sm), reaparece em sm+ com largura
        // adaptativa. Em telas <sm o user usa o menu pra navegar e os
        // filtros internos de cada page pra buscar.
        "ml-auto hidden flex-1 items-center gap-2 rounded-pill border border-border bg-surface-alt px-3 py-1.5 text-muted transition-all duration-[180ms] sm:flex sm:max-w-[280px] md:max-w-[320px]",
        "focus-within:border-dourado focus-within:bg-surface focus-within:shadow-[0_0_0_3px_rgba(198,158,91,0.12)]"
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <input
        type="search"
        placeholder="Buscar processo, cliente, peça…"
        className="min-w-0 flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
      />
      <kbd className="hidden rounded-[4px] border border-border bg-background px-1.5 py-px font-mono text-[0.7rem] text-muted lg:inline">
        Ctrl K
      </kbd>
    </div>
  )
}

function IconButton({ label, Icon }: { label: string; Icon: LucideIcon }) {
  return (
    <button
      type="button"
      aria-label={label}
      // Touch target 36x36 em mobile (proximo do WCAG 44 mas equilibrando
      // densidade da topbar) e 30x30 em desktop. Padding interno preserva
      // visual elegante em ambos.
      className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-transparent text-muted transition-colors duration-[180ms] hover:bg-dourado/10 hover:text-foreground sm:h-8 sm:w-8"
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </button>
  )
}

/* ========================================================================= */

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora ou apertar Escape
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  async function handleLogout() {
    setOpen(false)
    await logout()
    navigate("/login", { replace: true })
  }

  function goToConfig() {
    setOpen(false)
    navigate("/config")
  }

  function openChangePassword() {
    setOpen(false)
    setShowChangePassword(true)
  }

  const initials = user ? initialsFrom(user.display_name) : "?"
  const title = user?.display_name ?? "Usuário"

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu do usuário"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className="grid h-9 w-9 sm:h-8 sm:w-8 shrink-0 place-items-center rounded-full bg-dourado font-sans text-xs font-bold text-tinta transition-transform duration-[180ms] hover:scale-105"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-[calc(100%+8px)] z-30 min-w-[220px] overflow-hidden rounded-card border border-border bg-surface p-1.5 shadow-2"
          )}
        >
          {user && (
            <div className="border-b border-border px-3 py-2.5">
              <div className="truncate font-sans text-sm font-medium text-foreground">
                {user.display_name}
              </div>
              <div className="truncate font-mono text-[0.7rem] text-muted">
                {user.username} · {user.role}
              </div>
            </div>
          )}
          <MenuItem onClick={openChangePassword} icon={KeyRound}>
            Mudar minha senha
          </MenuItem>
          <MenuItem onClick={goToConfig} icon={Settings}>
            Configurações
          </MenuItem>
          <div className="my-1 h-px bg-border" />
          <MenuItem onClick={handleLogout} icon={LogOut}>
            Sair
          </MenuItem>
        </div>
      )}

      <ChangePasswordDialog
        open={showChangePassword}
        onOpenChange={setShowChangePassword}
      />
    </div>
  )
}

function MenuItem({
  onClick,
  icon: Icon,
  children,
}: {
  onClick: () => void
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left font-sans text-sm text-foreground transition-colors hover:bg-surface-alt"
    >
      <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
      <span>{children}</span>
    </button>
  )
}
