import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  fetchColetaDatajudStatus,
  fetchColetaDjenStatus,
  fetchColetaLog,
  queryKeys,
  startColetaDatajud,
  startColetaDjen,
} from "@/api/granola"
import type { ColetaLogEntry } from "@/types/domain"

/**
 * Hook generico pra coleta de publicacoes com feedback real-time.
 *
 * Padrao que serve tanto pra DataJud quanto DJEN (ambos o backend expoe
 * com a mesma forma: start endpoint dispara thread + /log paginado +
 * /status-especifico com resumo.fim como marcador de termino).
 *
 * Fluxo:
 *  1. start() -> POST /coletar-<fonte> (backend dispara em thread)
 *  2. Abre polls paralelos a cada ~1200ms:
 *     - GET /publicacoes/log?since=N  -> entries incrementais
 *     - GET /publicacoes-<fonte>/status -> confere se `resumo.fim` apareceu
 *  3. Enquanto roda: acumula entries em state
 *  4. Quando termina: para o polling, invalida caches (processos/stats/prazos),
 *     expoe o resumo final
 */

const POLL_INTERVAL_MS = 1200
/** Teto de seguranca: se nao detectarmos fim em 5min, paramos. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000

/** Shape minimo do resumo que os endpoints de status devolvem — ambos tem
 *  `inicio` e `fim` (string|null). O consumidor pode castar pra o tipo
 *  especifico da fonte se precisar dos campos extras. */
interface GenericResumo {
  inicio: string
  fim: string | null
  [key: string]: unknown
}

type StatusFetcher = () => Promise<{ resumo: GenericResumo | null }>

interface ColetaConfig {
  /** Funcao que dispara o start POST e retorna. */
  startFn: () => Promise<unknown>
  /** Funcao que retorna o status atual (com resumo.fim). */
  statusFn: StatusFetcher
}

const SOURCES: Record<"datajud" | "djen", ColetaConfig> = {
  datajud: {
    startFn: startColetaDatajud,
    statusFn: fetchColetaDatajudStatus,
  },
  djen: {
    startFn: startColetaDjen,
    statusFn: fetchColetaDjenStatus,
  },
}

export type ColetaPublicacoesSource = keyof typeof SOURCES

export interface UseColetaPublicacoesOptions<R extends GenericResumo> {
  onDone?: (resumo: R | null) => void
  onError?: (message: string) => void
  /** Se passado, invalida o detalhe desse processo quando a coleta termina. */
  invalidateProcessoId?: number
}

export interface UseColetaPublicacoesResult<R extends GenericResumo> {
  start: () => void
  running: boolean
  entries: ColetaLogEntry[]
  resumo: R | null
  error: string | null
  reset: () => void
}

/** Hook generico. Use os wrappers useColetaDatajud / useColetaDjen pra ergonomia. */
export function useColetaPublicacoes<R extends GenericResumo>(
  source: ColetaPublicacoesSource,
  options: UseColetaPublicacoesOptions<R> = {}
): UseColetaPublicacoesResult<R> {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<ColetaLogEntry[]>([])
  const [resumo, setResumo] = useState<R | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sinceRef = useRef(0)
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
    (finalResumo: R | null) => {
      stopPolling()
      setRunning(false)
      setResumo(finalResumo)
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      queryClient.invalidateQueries({ queryKey: ["granola", "prazos"] })
      queryClient.invalidateQueries({ queryKey: ["granola", "processos"] })
      if (source === "datajud") {
        queryClient.invalidateQueries({
          queryKey: queryKeys.coletaDatajudStatus,
        })
      } else {
        queryClient.invalidateQueries({
          queryKey: queryKeys.coletaDjenStatus,
        })
      }
      const pid = invalidateProcessoIdRef.current
      if (pid) {
        queryClient.invalidateQueries({ queryKey: queryKeys.processo(pid) })
      }
      onDoneRef.current?.(finalResumo)
    },
    [queryClient, source, stopPolling]
  )

  const config = SOURCES[source]

  const startMutation = useMutation({
    mutationFn: config.startFn,
    onSuccess: () => {
      startedAtRef.current = Date.now()
      setRunning(true)
      setEntries([])
      setResumo(null)
      setError(null)

      intervalRef.current = setInterval(async () => {
        try {
          const [logRes, statusRes] = await Promise.all([
            fetchColetaLog(sinceRef.current),
            config.statusFn(),
          ])

          if (logRes.entries.length > 0) {
            sinceRef.current = logRes.latest
            setEntries((prev) => {
              const merged = [...prev, ...logRes.entries]
              return merged.length > 200 ? merged.slice(-200) : merged
            })
          }

          const r = statusRes.resumo
          if (r?.fim && r.inicio) {
            const inicioTs = new Date(r.inicio).getTime()
            if (inicioTs + 1500 >= startedAtRef.current) {
              finish(r as R)
            }
          }
        } catch {
          // Erro transitorio — segue polling
        }
      }, POLL_INTERVAL_MS)

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

  return { start, running, entries, resumo, error, reset }
}
