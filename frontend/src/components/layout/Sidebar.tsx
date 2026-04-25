import { NavLink } from "react-router-dom"
import {
  Calendar,
  CircleDollarSign,
  Clock,
  FileText,
  Files,
  FolderOpen,
  Home,
  KanbanSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  badge?: number
}

interface NavSection {
  label: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    label: "Trabalho",
    items: [
      { to: "/agora", icon: Home, label: "Agora", badge: 7 },
      { to: "/clientes", icon: Users, label: "Clientes" },
      { to: "/processos", icon: FolderOpen, label: "Processos" },
      { to: "/kanban", icon: KanbanSquare, label: "Kanban" },
      { to: "/prazos", icon: Clock, label: "Prazos" },
      { to: "/agenda", icon: Calendar, label: "Agenda" },
      { to: "/financeiro", icon: CircleDollarSign, label: "Financeiro" },
    ],
  },
  {
    label: "Suporte",
    items: [
      { to: "/documentos", icon: Files, label: "Documentos" },
      { to: "/modelos", icon: FileText, label: "Modelos" },
      { to: "/config", icon: Settings, label: "Configurações" },
    ],
  },
]

interface SidebarProps {
  /** Callback quando o usuario clica num link — usado em mobile pra
   *  fechar o drawer. Em desktop fica undefined. */
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps = {}) {
  return (
    <aside
      className={cn(
        "relative flex h-full w-full flex-col bg-roxo pb-6 pt-5 text-marfim md:w-[240px]",
        // Filete dourado vertical separando sidebar do conteudo
        "after:pointer-events-none after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-dourado/20"
      )}
    >
      {/* Marca */}
      <div className="mb-2 flex items-center gap-2.5 border-b border-dourado/15 px-5 pb-5">
        <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-dourado/30 bg-marfim">
          {/* Placeholder da marca — trocar pelo logotipo oficial quando disponivel */}
          <span className="font-display text-base font-semibold text-tinta">G</span>
        </span>
        <div className="font-display text-[1.4rem] font-medium leading-none text-marfim">
          granola
          <span className="mt-0.5 block font-sans text-[0.55rem] font-semibold uppercase tracking-[0.32em] text-dourado">
            CRM
          </span>
        </div>
      </div>

      {/* Navegacao */}
      <nav aria-label="Principal" className="flex-1 overflow-y-auto">
        {SECTIONS.map((section) => (
          <div key={section.label} className="mt-1.5">
            <div className="px-5 pb-1 pt-3 font-sans text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-marfim/40">
              {section.label}
            </div>
            {section.items.map((item) => (
              <SidebarLink key={item.to} {...item} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>

      {/* Rodape — status do backup (placeholder ate ligar a API real) */}
      <div className="mt-4 border-t border-dourado/15 px-5 pt-3.5 font-mono text-[0.7rem] text-marfim/55">
        <div className="mb-1 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-sucesso" aria-hidden />
          Backup local · 22h14
        </div>
        <div>v 2.0.0 · base.db 38 MB</div>
      </div>
    </aside>
  )
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  badge,
  onNavigate,
}: NavItem & { onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === "/agora"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex select-none items-center gap-[11px] border-l-[3px] px-[17px] py-2.5 font-sans text-sm font-medium transition-colors duration-[180ms]",
          isActive
            ? "border-dourado bg-roxo-claro text-marfim"
            : "border-transparent text-marfim/75 hover:bg-roxo-claro/50 hover:text-marfim"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "grid h-4 w-4 shrink-0 place-items-center transition-colors",
              isActive ? "text-dourado" : "text-marfim/60"
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="flex-1 truncate">{label}</span>
          {badge !== undefined && (
            <span className="rounded-pill bg-dourado px-[7px] py-0.5 font-mono text-[0.65rem] font-bold text-tinta">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}
