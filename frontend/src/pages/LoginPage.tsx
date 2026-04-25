import { type FormEvent, useState } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@/lib/auth-context"
import { ApiError } from "@/api/client"
import { cn } from "@/lib/utils"

/**
 * Redirect helper: so aceita caminho relativo que comeca com "/" pra evitar
 * open-redirect (ex: ?next=//attacker.com/...).
 */
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/agora"
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/agora"
  return raw
}

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = sanitizeNext(searchParams.get("next"))
  const { login, isAuthenticated, isLoading: isCheckingSession } = useAuth()

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ja logado? Volta pra destino (ou /agora). Evita ver a tela de login enquanto redireciona.
  if (!isCheckingSession && isAuthenticated) {
    return <Navigate to={next} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError("Preencha usuario e senha.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const user = await login(username.trim(), password)
      // Force change password: o admin resetou a senha. Manda direto pro
      // /config?force-change=1 — ConfigPage abre o ChangePasswordDialog em
      // modo forced (sem botao de cancelar) ate o usuario trocar.
      if (user.must_change_password === 1) {
        navigate("/config?force-change=1", { replace: true })
      } else {
        navigate(next, { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? "Usuario ou senha invalidos." : err.message)
      } else {
        setError("Nao foi possivel autenticar. Verifique se o backend esta em pe em :3458.")
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-roxo px-8 py-12">
      <div
        className={cn(
          "grid w-full max-w-[1080px] items-center gap-10 rounded-card overflow-hidden",
          "grid-cols-1 md:grid-cols-2"
        )}
      >
        {/* Lado marca — texto Cormorant + filete dourado */}
        <aside className="px-6 py-10 text-marfim md:order-1 md:justify-self-end md:pr-8 md:text-left">
          <p className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-dourado">
            Granola CRM
          </p>
          <h1 className="font-display mt-4 text-4xl font-normal leading-tight md:text-5xl">
            O escritorio<br />
            que cabe no bolso.
          </h1>
          <p className="font-display mt-3 text-xl italic text-marfim/70">
            Do grao ao sistema.
          </p>
          <div className="mt-6 h-px w-[60px] bg-dourado" aria-hidden />
          <p className="mt-6 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-marfim/50">
            v 2.0.0 · 2026
          </p>
        </aside>

        {/* Card de login — Marfim sobre Roxo */}
        <form
          onSubmit={handleSubmit}
          className="relative w-full max-w-[380px] justify-self-center rounded-card bg-marfim px-10 py-11 shadow-elev md:order-2 md:justify-self-start"
        >
          {/* Filete dourado vertical do Brandbook */}
          <div className="absolute left-0 top-12 bottom-12 w-[3px] bg-dourado" aria-hidden />

          {/* Logo placeholder — substituir pelo logotipo real quando disponivel */}
          <div className="mb-5 grid place-items-center">
            <div className="grid h-16 w-16 place-items-center rounded-full border border-dourado/40 bg-marfim">
              <span className="font-display text-3xl font-semibold text-tinta">G</span>
            </div>
          </div>

          <Field
            label="Usuario ou e-mail"
            type="text"
            value={username}
            onChange={setUsername}
            autoComplete="username"
            placeholder="admin"
            autoFocus
          />
          <Field
            label="Senha"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            placeholder="••••••••••••"
          />

          {error && (
            <p
              role="alert"
              className="mt-2 border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={cn(
              "mt-4 flex w-full items-center justify-center gap-2 rounded-card bg-dourado px-5 py-3",
              "font-sans text-sm font-semibold text-tinta transition-all duration-[180ms]",
              "hover:bg-dourado-claro hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]",
              "active:translate-y-px",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {submitting ? "Autenticando…" : "Entrar"}
          </button>

          <button
            type="button"
            onClick={() => alert("Recuperacao de senha ainda nao implementada no backend.")}
            className="mt-5 block w-full text-center font-sans text-sm text-dourado underline decoration-dourado/50 underline-offset-[3px] hover:decoration-dourado"
          >
            Esqueci minha senha
          </button>

          {/* Dica de credenciais em modo DEV — some em producao (import.meta.env.DEV) */}
          {import.meta.env.DEV && (
            <p className="mt-6 border-t border-tinta/10 pt-4 text-center font-mono text-[0.7rem] uppercase tracking-wider text-tinta/50">
              dev · admin / granola2026
            </p>
          )}
        </form>
      </div>
    </div>
  )
}

/* =========================================================================
   Subcomponente do formulario — isolado pra nao poluir o corpo do LoginPage
   ========================================================================= */

interface FieldProps {
  label: string
  type: "text" | "password"
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  placeholder?: string
  autoFocus?: boolean
}

function Field({ label, type, value, onChange, autoComplete, placeholder, autoFocus }: FieldProps) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 block font-sans text-[0.7rem] font-bold uppercase tracking-[0.12em] text-tinta">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn(
          "w-full border-0 border-b border-tinta/25 bg-transparent pb-2 pt-1",
          "font-sans text-[0.9375rem] text-tinta outline-none transition-colors duration-[180ms]",
          "placeholder:text-tinta/35",
          "focus:border-dourado"
        )}
      />
    </label>
  )
}
