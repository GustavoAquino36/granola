import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react"
import { postChangePassword } from "@/api/auth"
import { AUTH_ME_KEY } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface ChangePasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Modo "obrigatorio" (force-change): troca o titulo/copy + esconde botao Cancelar. */
  forced?: boolean
  onSuccess?: () => void
}

/**
 * Dialog reusavel pra trocar senha do usuario LOGADO.
 * Validacoes:
 * - >= 6 chars (bate com backend)
 * - Confirmacao = nova senha
 *
 * Em modo `forced`, o usuario nao pode dispensar — usado quando o admin
 * resetou a senha (must_change_password=1).
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
  forced,
  onSuccess,
}: ChangePasswordDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Em forced, ignora tentativas de fechar via overlay/Esc
        if (!forced) onOpenChange(o)
      }}
    >
      <DialogContent
        className="sm:max-w-[440px]"
        onInteractOutside={(e) => forced && e.preventDefault()}
        onEscapeKeyDown={(e) => forced && e.preventDefault()}
      >
        {open && (
          <ChangePasswordInner
            forced={forced}
            onClose={() => onOpenChange(false)}
            onSuccess={onSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ChangePasswordInner({
  forced,
  onClose,
  onSuccess,
}: {
  forced?: boolean
  onClose: () => void
  onSuccess?: () => void
}) {
  const queryClient = useQueryClient()
  const [pw, setPw] = useState("")
  const [confirm, setConfirm] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: postChangePassword,
    onSuccess: () => {
      // Marca o usuario como nao mais "must_change" no cache local
      queryClient.setQueryData(AUTH_ME_KEY, (prev: unknown) =>
        prev && typeof prev === "object"
          ? { ...prev, must_change_password: 0 }
          : prev
      )
      onSuccess?.()
      onClose()
    },
  })

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (pw.length < 6) {
      setLocalError("A senha precisa ter no mínimo 6 caracteres.")
      return
    }
    if (pw !== confirm) {
      setLocalError("A confirmação não bate com a nova senha.")
      return
    }
    mutation.mutate(pw)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">
          {forced ? "Defina sua nova senha" : "Mudar senha"}
        </DialogTitle>
        <DialogDescription>
          {forced ? (
            <>
              Sua senha atual foi marcada para troca obrigatória pelo administrador.
              Defina uma nova senha pra continuar.
            </>
          ) : (
            <>Mínimo de 6 caracteres. Não há requisitos de complexidade.</>
          )}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="cp-new">Nova senha</Label>
          <Input
            id="cp-new"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-confirm">Confirme</Label>
          <Input
            id="cp-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>

        {(localError || mutation.isError) && (
          <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
            {localError ||
              (mutation.error instanceof Error
                ? mutation.error.message
                : "Não foi possível trocar a senha.")}
          </p>
        )}

        {mutation.isSuccess && (
          <p className="inline-flex items-center gap-1.5 rounded-card border-l-2 border-sucesso bg-sucesso/8 px-3 py-2 text-sm text-sucesso">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Senha trocada.
          </p>
        )}

        <DialogFooter className="sm:justify-end">
          {!forced && (
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending}
            className={cn(
              "gap-1.5 bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Trocar senha
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
