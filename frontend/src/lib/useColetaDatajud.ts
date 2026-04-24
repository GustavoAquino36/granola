import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  fetchColetaDatajudStatus,
  fetchColetaLog,
  queryKeys,
  startColetaDatajud,
} from "@/api/granola"
import type {
  ColetaDatajudResumo,
  ColetaLogEntry,
} from "@/types/domain"

/**
 * Hook pra rodar a coleta DataJud com feedback real-time.
 *
 * Fluxo:
 *  1. startColeta() -> POST /publicacoes/coletar-datajud (backend fira em thread)
 *  2. Abre 2 polls em paralelo a cada ~1200ms:
 *     - GET /publicacoes/log?since=N  -> recebe eventos incrementais
 *     - GET /publicacoes-datajud/status -> conferimos se `resumo.fim` apareceu
 *  3. Enquanto roda: acumula entries em state, chama onDone quando detecta fim
 *  4. Quando termina: para o polling, invalida caches relevantes
 *     (processo detalhe, stats, prazos), expoe o resumo final
 *
 * Uso:
 *   const coleta = useColetaDatajud({
 *     onDone: (resumo) => toast(`${resumo.com_novidade} novidades`),
 *     invalidateProcessoId: 42 // opcional: invalida esse detalhe em particular
 *   })
 *   coleta.start()
 *   // -> coleta.running === true, coleta.entries cresce, coleta.done dispara no final
 */

const POLL_INTERVAL_MS = 1200
/** Teto de seguranca: se nao detectarmos fim em 5min, paramos. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000

export interface UseColetaDatajudOptions {
  onDone?: (resumo: ColetaDatajudResumo | null) => void
  onError?: (message: string) => void
  /** Se passado, invalida o detalhe desse processo quando a coleta termina. */
  invalidateProcessoId?: number
}

export interface UseColetaDatajudResult {
  /** Dispara a coleta no backend + ativa o polling. */
  start: () => void
  /** True enquanto a coleta esta em andamento (do iniciar ao fim). */
  running: boolean
  /** Entries acumuladas do log desde o start (ordem cronologica). */
  entries: ColetaLogEntry[]
  /** Resumo consolidado quando a coleta termina (ou null se nao terminou). */
  resumo: ColetaDatajudResumo | null
  /** Mensagem de erro se o start falhou. */
  error: string | null
  /** Reset do state — normalmente nao e necessario. */
  reset: () => void
}

export function useColetaDatajud(
  options: UseColetaDatajudOptions = {}
): UseColetaDatajudResult {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<ColetaLogEntry[]>([])
  const [resumo, setResumo] = useState<ColetaDatajudResumo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Cursor do log (ultima seq vista)
  const sinceRef = useRef(0)
  // Timestamp do start — pra comparar com resumo.inicio e saber se e "nossa" coleta
  const startedAtRef = useRef<number>(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onDoneRef = useRef(options.onDone)
  const onErrorRef = useRef(options.onError)
  const invalidateProcessoIdRef = useRef(options.invalidateProcessoId)
  useEffect(() => {
    onDoneRef.current = options.onDone
    onErrorRef.current = options.onError
    invalidateProcessoIdRef.current = options.invalidateProcessoId
  }, [options.onDone, options.onError, options.invalidateProcessoId])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const finish = useCallback(
    (finalResumo: ColetaDatajudResumo | null) => {
      stopPolling()
      setRunning(false)
      setResumo(finalResumo)
      // Invalida caches afetados pela coleta
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      queryClient.invalidateQueries({ queryKey: ["granola", "prazos"] })
      queryClient.invalidateQueries({ queryKey: ["granola", "processos"] })
      const pid = invalidateProcessoIdRef.current
      if (pid) {
        queryClient.invalidateQueries({ queryKey: queryKeys.processo(pid) })
      }
      onDoneRef.current?.(finalResumo)
    },
    [queryClient, stopPolling]
  )

  const startMutation = useMutation({
    mutationFn: startColetaDatajud,
    onSuccess: () => {
      startedAtRef.current = Date.now()
      setRunning(true)
      setEntries([])
      setResumo(null)
      setError(null)

      // Abre o polling
      intervalRef.current = setInterval(async () => {
        try {
          const [logRes, statusRes] = await Promise.all([
            fetchColetaLog(sinceRef.current),
            fetchColetaDatajudStatus(),
          ])

          if (logRes.entries.length > 0) {
            sinceRef.current = logRes.latest
            // Mantemos ate 200 entries pra nao explodir memoria em coletas longas
            setEntries((prev) => {
              const merged = [...prev, ...logRes.entries]
              return merged.length > 200 ? merged.slice(-200) : merged
            })
          }

          // Detecta fim: resumo.fim preenchido e inicio posterior ao nosso start
          // (protege contra ler o resumo da coleta ANTERIOR)
          const r = statusRes.resumo
          if (r?.fim && r.inicio) {
            const inicioTs = new Date(r.inicio).getTime()
            if (inicioTs + 1500 >= startedAtRef.current) {
              finish(r)
            }
          }
        } catch {
          // Erro transitorio de rede durante polling — segue tentando.
        }
      }, POLL_INTERVAL_MS)

      // Timeout de seguranca
      timeoutRef.current = setTimeout(() => {
        finish(null)
      }, POLL_TIMEOUT_MS)
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Falha ao iniciar a coleta."
      setError(msg)
      onErrorRef.current?.(msg)
    },
  })

  // Cleanup em unmount
  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const start = useCallback(() => {
    if (running || startMutation.isPending) return
    startMutation.mutate()
  }, [running, startMutation])

  const reset = useCallback(() => {
    stopPolling()
    setRunning(false)
    setEntries([])
    setResumo(null)
    setError(null)
    sinceRef.current = 0
  }, [stopPolling])

  return {
    start,
    running,
    entries,
    resumo,
    error,
    reset,
  }
}
