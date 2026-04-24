import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ExternalLink, Loader2, Settings2 } from "lucide-react"
import {
  fetchGcalCalendars,
  queryKeys,
  setGcalCalendar,
  startGcalAuth,
} from "@/api/granola"
import type { GcalStatus } from "@/types/domain"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface GcalConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: GcalStatus | undefined
}

/**
 * Dialog de configuração do Google Calendar:
 * - Não autenticado: explica e oferece botão "Conectar Google" (abre OAuth em nova aba)
 * - Autenticado: lista calendários e permite escolher qual receberá os eventos
 *
 * Importante: o backend precisa de gcal_credentials.json (do Google Cloud
 * Console) configurado em granola/data/. Sem isso, o botão Conectar retorna
 * erro 400 com mensagem orientadora — exibimos diretamente.
 */
export function GcalConnectDialog({
  open,
  onOpenChange,
  status,
}: GcalConnectDialogProps) {
  const queryClient = useQueryClient()
  const [authError, setAuthError] = useState<string | null>(null)
  const isAuth = status?.authenticated === true

  const { data: calendarsData, isLoading: loadingCalendars } = useQuery({
    queryKey: queryKeys.gcalCalendars,
    queryFn: fetchGcalCalendars,
    enabled: open && isAuth,
  })

  const [selectedCalendar, setSelectedCalendar] = useState<string>(
    status?.calendar_id ?? ""
  )

  const authMutation = useMutation({
    mutationFn: startGcalAuth,
    onSuccess: ({ auth_url }) => {
      // Abre OAuth do Google em nova aba; o callback do backend renderiza
      // HTML que fecha automaticamente
      window.open(auth_url, "_blank", "noopener,noreferrer")
      setAuthError(null)
      // Polling pra detectar conclusao do auth — invalida status periodicamente
      const interval = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.gcalStatus })
      }, 2500)
      // Para o polling depois de 2 minutos
      setTimeout(() => clearInterval(interval), 120_000)
    },
    onError: (err) => {
      setAuthError(
        err instanceof Error
          ? err.message
          : "Falha ao iniciar autenticação Google"
      )
    },
  })

  const setCalMutation = useMutation({
    mutationFn: setGcalCalendar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gcalStatus })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            Google Calendar
          </DialogTitle>
          <DialogDescription>
            Sincronize a agenda do Granola com o seu Google Calendar pra ver os compromissos
            no celular automaticamente.
          </DialogDescription>
        </DialogHeader>

        {!isAuth ? (
          <div className="space-y-4">
            <div className="rounded-card border border-border bg-surface-alt px-4 py-3">
              <div className="font-sans text-sm text-foreground">
                Status: <span className="font-medium text-muted">não conectado</span>
              </div>
              <p className="mt-1 text-[0.8rem] text-muted">
                Conectar abre o Google em uma nova aba pra autorizar o Granola a criar e
                editar eventos. Suas credenciais não saem da sua máquina —
                a OAuth é direta entre browser e Google.
              </p>
            </div>

            {authError && (
              <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
                {authError}
                {authError.toLowerCase().includes("credentials") && (
                  <span className="mt-1 block text-[0.78rem]">
                    Esta instalação ainda não tem o arquivo de credenciais OAuth do Google
                    Cloud Console em <code className="font-mono text-[0.72rem]">granola/data/gcal_credentials.json</code>.
                  </span>
                )}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Fechar
              </Button>
              <Button
                type="button"
                onClick={() => authMutation.mutate()}
                disabled={authMutation.isPending}
                className={cn(
                  "gap-1.5 bg-dourado text-tinta hover:bg-dourado-claro",
                  "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
                )}
              >
                {authMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                Conectar Google
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 rounded-card border border-sucesso/20 bg-sucesso/[0.04] px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-sucesso" strokeWidth={2} />
              <div className="font-sans text-sm font-medium text-foreground">
                Conectado ao Google Calendar
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[0.78rem] font-medium text-foreground">
                Agenda alvo
              </label>
              <p className="text-[0.72rem] text-muted">
                Eventos do Granola serão criados nesta agenda. Mude se quiser separar
                trabalho de pessoal.
              </p>
              {loadingCalendars ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select
                  value={selectedCalendar}
                  onValueChange={setSelectedCalendar}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar agenda" />
                  </SelectTrigger>
                  <SelectContent>
                    {(calendarsData?.calendars ?? []).map((cal) => (
                      <SelectItem key={cal.id} value={cal.id}>
                        {cal.summary}
                        {cal.primary ? " · principal" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {setCalMutation.isError && (
              <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
                {setCalMutation.error instanceof Error
                  ? setCalMutation.error.message
                  : "Não foi possível salvar."}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() =>
                  selectedCalendar && setCalMutation.mutate(selectedCalendar)
                }
                disabled={
                  !selectedCalendar ||
                  selectedCalendar === status?.calendar_id ||
                  setCalMutation.isPending
                }
                className={cn(
                  "gap-1.5 bg-dourado text-tinta hover:bg-dourado-claro",
                  "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
                )}
              >
                {setCalMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                Salvar agenda alvo
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
