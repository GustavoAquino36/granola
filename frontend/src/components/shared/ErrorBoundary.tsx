import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

interface ErrorBoundaryProps {
  children: ReactNode
  /** Renderizado quando ocorre erro. Default = tela full-page Valerius. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Error Boundary global. Captura erros sincronos de render dos filhos
 * (NAO captura erros de async, eventos, ou hooks — esses precisam de
 * try/catch ou tratamento via TanStack Query).
 *
 * Casos de uso reais:
 * - Chunk JS que falha ao carregar (rede flutua, deploy partial)
 * - Bug de runtime em algum componente que joga exception
 * - Cache do TanStack Query corrompido
 *
 * Sem este boundary, qualquer erro derruba o app inteiro pra tela branca
 * (React 18+ unmounta a arvore em erros nao-capturados).
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Em dev, console mostra o stack completo; produçao loga sem detalhe.
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary]", error, info)
    }
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    const { children, fallback } = this.props

    if (error) {
      if (fallback) return fallback(error, this.reset)
      return <DefaultFallback error={error} onReset={this.reset} />
    }

    return children
  }
}

function DefaultFallback({
  error,
  onReset,
}: {
  error: Error
  onReset: () => void
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-[480px] text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-erro/10 text-erro">
          <AlertTriangle className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <h1 className="font-display text-3xl font-normal text-foreground">
          Algo quebrou aqui.
        </h1>
        <p className="font-display mt-2 text-base italic text-muted">
          Não é culpa sua. A gente segura o erro e tenta de novo.
        </p>
        {import.meta.env.DEV && (
          <pre className="mt-4 overflow-auto rounded-card border border-border bg-surface-alt px-3 py-2 text-left font-mono text-[0.72rem] text-muted">
            {error.message}
            {error.stack && (
              <>
                {"\n\n"}
                {error.stack.split("\n").slice(0, 5).join("\n")}
              </>
            )}
          </pre>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              onReset()
              window.location.reload()
            }}
            className="inline-flex items-center gap-1.5 rounded-card bg-dourado px-4 py-2 font-sans text-sm font-semibold text-tinta transition-all hover:bg-dourado-claro hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            Recarregar
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-card border border-border-strong bg-surface px-4 py-2 font-sans text-sm font-medium text-foreground transition-colors hover:border-dourado"
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  )
}
