import { useParams } from "react-router-dom"

interface PlaceholderPageProps {
  title: string
  /** Fase do roadmap em que esta pagina entrega de verdade. */
  phase: number
  /** Descricao curta do que a fase vai trazer. Opcional. */
  hint?: string
}

/**
 * Placeholder elegante pra rotas que ainda nao foram implementadas.
 * Pensado pra ficar "nao-feio" mesmo durante meses de desenvolvimento —
 * tipografia do Brandbook + filete dourado + tom honesto.
 */
export function PlaceholderPage({ title, phase, hint }: PlaceholderPageProps) {
  const params = useParams()
  const displayTitle = title.includes(":id") && params.id
    ? title.replace(":id", params.id)
    : title

  return (
    <div className="flex min-h-[calc(100vh-54px)] items-center justify-center px-8 py-16">
      <div className="flex max-w-lg flex-col items-center text-center">
        <p className="text-eyebrow font-semibold uppercase text-dourado">
          Em construção · Fase {phase}
        </p>

        <h1 className="font-display mt-4 text-5xl font-normal leading-tight text-foreground">
          {displayTitle}
        </h1>

        <div className="mt-5 h-px w-12 bg-dourado" aria-hidden />

        <p className="font-display mt-5 text-xl italic leading-relaxed text-muted">
          {hint ?? "Esta area sera entregue no ciclo previsto. Voce esta vendo o shell porque o roteamento ja esta em pe."}
        </p>

        <p className="mt-8 font-mono text-xs uppercase tracking-[0.22em] text-muted/70">
          granola · frontend-v2 · sprint em andamento
        </p>
      </div>
    </div>
  )
}
