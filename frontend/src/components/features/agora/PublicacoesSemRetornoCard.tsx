import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Loader2, Search } from "lucide-react"
import {
  fetchColetaDatajudStatus,
  queryKeys,
  startVerificacaoManual,
} from "@/api/granola"
import { formatCNJ, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Card "Publicacoes sem retorno" — alimentado por resumo.nao_encontrados
 * da ultima coleta DataJud. Reforca paridade com o monolito (onde esse card
 * substituiu o antigo "Publicacoes Automaticas" em 2026-04-20).
 *
 * Acao principal: botao "Verificacao manual" que dispara o fallback Selenium
 * (e-SAJ + PJe) pros faltantes. So funciona em producao — requer Chromium
 * aberto no CDP 9222 com sessao logada no certificado digital do advogado.
 */
export function PublicacoesSemRetornoCard() {
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.coletaDatajudStatus,
    queryFn: fetchColetaDatajudStatus,
  })

  const verificacao = useMutation({
    mutationFn: startVerificacaoManual,
    onSuccess: (res) => {
      setFeedback(res.msg)
      // Dispara reload do status apos alguns segundos pra dar tempo do Selenium
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.coletaDatajudStatus,
        })
      }, 2000)
    },
    onError: (err) => {
      setFeedback(
        err instanceof Error
          ? err.message
          : "Falha ao iniciar verificacao manual."
      )
    },
  })

  const faltantes = data?.resumo?.nao_encontrados ?? []
  const coletaNunca = !data?.ultima_coleta

  return (
    <Card className="gap-0 overflow-hidden rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
          Publicações sem retorno
        </CardTitle>
        {faltantes.length > 0 && (
          <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-pill bg-erro/15 px-1.5 text-[0.7rem] font-bold text-erro">
            {faltantes.length}
          </span>
        )}
        <CardAction>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-card"
            disabled={
              verificacao.isPending || faltantes.length === 0 || coletaNunca
            }
            onClick={() => {
              setFeedback(null)
              verificacao.mutate()
            }}
            title={
              coletaNunca
                ? "Rode a coleta DataJud primeiro"
                : faltantes.length === 0
                  ? "Nada sem retorno pra verificar"
                  : "Verificação manual (Selenium) — requer Chromium aberto"
            }
          >
            {verificacao.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Search className="h-3 w-3" strokeWidth={1.75} />
            )}
            {verificacao.isPending ? "Iniciando…" : "Verificar manualmente"}
          </Button>
        </CardAction>
      </CardHeader>

      {/* Feedback da verificacao */}
      {feedback && (
        <div
          className={cn(
            "flex items-start gap-2 border-b px-5 py-2.5 text-[0.8125rem]",
            verificacao.isError
              ? "border-erro/20 bg-erro/5 text-erro"
              : "border-dourado/25 bg-dourado/5 text-foreground"
          )}
        >
          <AlertCircle
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            strokeWidth={1.75}
          />
          <span className="min-w-0">{feedback}</span>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-card" />
          ))}
        </div>
      ) : isError ? (
        <CardContent className="px-5 py-6 text-sm text-erro">
          Não foi possível carregar o status da coleta.
        </CardContent>
      ) : coletaNunca ? (
        <CardContent className="px-5 py-6 text-center">
          <p className="font-display italic text-muted text-base">
            Nenhuma coleta DataJud rodou ainda. Abra um processo e clique em{" "}
            <strong className="not-italic text-foreground">Coletar DataJud</strong>{" "}
            pra ver aqui o que ficou sem retorno.
          </p>
        </CardContent>
      ) : faltantes.length === 0 ? (
        <CardContent className="px-5 py-6 text-center">
          <p className="font-display italic text-muted text-base">
            Todos os processos retornaram da ultima coleta. Zero faltantes.
          </p>
        </CardContent>
      ) : (
        <ul>
          {faltantes.slice(0, 8).map((f) => (
            <li
              key={f.processo_id}
              className="flex items-start justify-between gap-3 border-b border-border px-5 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/processos/${f.processo_id}`}
                  className="font-sans text-[0.875rem] font-medium text-foreground transition-colors hover:text-dourado"
                >
                  {truncate(f.titulo, 46)}
                </Link>
                <div className="mt-0.5 flex items-center gap-2 text-[0.72rem] text-muted">
                  <span className="tabular-nums font-mono">
                    {formatCNJ(f.numero_cnj)}
                  </span>
                  {f.tribunal_alias && (
                    <>
                      <span>·</span>
                      <span className="uppercase tracking-wider">
                        {f.tribunal_alias}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Link
                to={`/processos/${f.processo_id}`}
                className="shrink-0 self-center rounded-card border border-border-strong px-2.5 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-dourado"
              >
                Verificar
              </Link>
            </li>
          ))}
          {faltantes.length > 8 && (
            <li className="border-t border-border px-5 py-2.5 text-center text-[0.75rem] text-muted">
              Mostrando 8 de {faltantes.length} faltantes.
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}
