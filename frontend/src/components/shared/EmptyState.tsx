import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  /** Mensagem principal — Cormorant italic muted no estilo Brandbook v2. */
  title: string
  /** Texto auxiliar curto. Pode usar <strong> nos pontos importantes. */
  description?: React.ReactNode
  /** Icone decorativo no topo. Padrao: nenhum. */
  icon?: LucideIcon
  /** CTA primario opcional (ex: "Adicionar primeiro cliente"). */
  action?: React.ReactNode
  /** Tamanho — small pra cards do dashboard, default pra pages. */
  size?: "sm" | "default"
  className?: string
}

/**
 * Estado vazio padronizado pra listas/grids/cards do projeto.
 *
 * Uso:
 *   <EmptyState
 *     icon={UserPlus}
 *     title="Nenhum cliente cadastrado ainda."
 *     description={<>Para começar, adicione o primeiro.</>}
 *     action={<Button>+ Adicionar cliente</Button>}
 *   />
 *
 * Antes da Fase 6.5 cada page tinha seu proprio empty state com tom
 * inconsistente (alguns com icone, outros sem; alguns Cormorant, outros
 * Inter). Agora todos passam por aqui — visual unico, brandbook respeitado.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  size = "default",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "text-center",
        size === "default" ? "px-5 py-12" : "px-4 py-6",
        className
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "mx-auto text-muted/60",
            size === "default" ? "mb-4 h-8 w-8" : "mb-3 h-6 w-6"
          )}
          strokeWidth={1.5}
        />
      )}
      <p
        className={cn(
          "font-display italic text-muted",
          size === "default" ? "text-lg" : "text-base"
        )}
      >
        {title}
      </p>
      {description && (
        <p
          className={cn(
            "text-muted",
            size === "default" ? "mt-2 text-sm" : "mt-1.5 text-[0.8rem]"
          )}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
