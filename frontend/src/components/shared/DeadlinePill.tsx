import { describeDeadline, type DeadlineStatus } from "@/lib/format"
import { cn } from "@/lib/utils"

const STYLE_MAP: Record<
  DeadlineStatus,
  { bg: string; fg: string; dot: string }
> = {
  vencido: { bg: "bg-erro/12", fg: "text-erro", dot: "bg-erro" },
  hoje: { bg: "bg-erro/10", fg: "text-erro", dot: "bg-erro" },
  urgente: { bg: "bg-erro/10", fg: "text-erro", dot: "bg-erro" },
  proximo: { bg: "bg-alerta/12", fg: "text-alerta", dot: "bg-alerta" },
  ok: { bg: "bg-sucesso/12", fg: "text-sucesso", dot: "bg-sucesso" },
}

interface DeadlinePillProps {
  /** Data de vencimento (ISO ou Date). Ja calcula o status internamente. */
  data: string | Date | null | undefined
  /** Pode passar `now` pra fixar referencia (testing). */
  now?: Date
  className?: string
}

/**
 * Pill visual de vencimento — dot + texto curto pt-BR ("vencido há X dias",
 * "vence hoje", "vence em N dias"). Cor segue a severidade do `describeDeadline`.
 *
 * Aceita o padrao do brandbook v2: cor sozinha nao comunica status, sempre
 * tem dot + texto.
 */
export function DeadlinePill({ data, now, className }: DeadlinePillProps) {
  const deadline = describeDeadline(data, now)
  const style = STYLE_MAP[deadline.status]
  if (!deadline.label) return null
  // Pulse sutil pra prazos vencidos/hoje — atencao sem agredir
  const shouldPulse = deadline.status === "vencido" || deadline.status === "hoje"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-[0.7rem] font-semibold",
        style.bg,
        style.fg,
        shouldPulse && "animate-deadline-pulse",
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden />
      {deadline.label}
    </span>
  )
}
