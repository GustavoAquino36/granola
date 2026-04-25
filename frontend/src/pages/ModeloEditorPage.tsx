import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Loader2,
  MoreHorizontal,
  Save,
  Trash2,
} from "lucide-react"
import {
  deleteModelo,
  fetchModeloById,
  queryKeys,
  upsertModelo,
  usarModelo,
} from "@/api/granola"
import type { Modelo } from "@/types/domain"
import { useAuth } from "@/lib/auth-context"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  CATEGORIAS_MODELO,
  labelDeCategoria,
} from "@/components/features/modelos/categorias"
import { ModeloAnexosPanel } from "@/components/features/modelos/ModeloAnexosPanel"
import { RichTextEditor } from "@/components/features/modelos/RichTextEditor"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Editor de Modelo — single-page Notion-style.
 *
 * Rotas:
 * - /modelos/novo : modo create. "Salvar" cria + redireciona pra /modelos/:id
 * - /modelos/:id  : modo edit. "Salvar" atualiza (incrementa versao no backend)
 *
 * Tres areas verticais:
 * 1. Topbar: voltar + nome + categoria + tags + botao Salvar + dropdown menu
 * 2. Editor Tiptap (RichTextEditor)
 * 3. Painel de anexos (so em modo edit — anexos precisam de modelo_id)
 *
 * Auto-update: o "Usar este modelo" copia HTML pra clipboard + incrementa
 * counter no backend. Versao auto-incrementa em cada save (sem historico
 * de versoes ainda — entra em iteracao futura).
 */
export function ModeloEditorPage() {
  const params = useParams<{ id: string }>()
  const isNew = params.id === "novo"
  const id = isNew ? null : Number(params.id)

  if (isNew) return <CreateMode />
  if (id == null || Number.isNaN(id)) {
    return <NotFound />
  }
  return <EditMode id={id} />
}

// --------------------------------------------------------------------------
// CREATE MODE
// --------------------------------------------------------------------------

function CreateMode() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [nome, setNome] = useState("")
  const [categoria, setCategoria] = useState<string>("outros")
  const [descricao, setDescricao] = useState("")
  const [tags, setTags] = useState("")
  const [conteudo, setConteudo] = useState("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      upsertModelo({
        nome: nome.trim(),
        categoria,
        descricao: descricao.trim() || null,
        tags: tags.trim() || null,
        conteudo,
      }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "modelos"] })
      navigate(`/modelos/${id}`, { replace: true })
    },
  })

  function onSave() {
    if (nome.trim().length < 2) {
      setErrorMsg("Dê um nome ao modelo (mínimo 2 caracteres).")
      return
    }
    setErrorMsg(null)
    mutation.mutate()
  }

  return (
    <EditorShell
      title="Novo modelo"
      subtitle="vai pro acervo após o primeiro salvamento"
      onBack={() => navigate("/modelos")}
      saveLabel={mutation.isPending ? "Salvando…" : "Salvar"}
      saveDisabled={mutation.isPending}
      onSave={onSave}
      footerInfo="rascunho · sem versão · 0 usos"
    >
      <Metadata
        nome={nome}
        onNomeChange={setNome}
        categoria={categoria}
        onCategoriaChange={setCategoria}
        descricao={descricao}
        onDescricaoChange={setDescricao}
        tags={tags}
        onTagsChange={setTags}
      />

      <RichTextEditor value={conteudo} onChange={setConteudo} />

      {(errorMsg || mutation.isError) && (
        <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
          {errorMsg ||
            (mutation.error instanceof Error
              ? mutation.error.message
              : "Não foi possível salvar.")}
        </p>
      )}

      <p className="rounded-card border border-border bg-surface-alt px-4 py-3 text-[0.78rem] italic text-muted">
        Anexos ficam disponíveis depois do primeiro salvamento — eles são
        amarrados ao modelo no banco.
      </p>
    </EditorShell>
  )
}

// --------------------------------------------------------------------------
// EDIT MODE
// --------------------------------------------------------------------------

function EditMode({ id }: { id: number }) {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.modelo(id),
    queryFn: () => fetchModeloById(id),
  })

  if (isLoading) {
    return (
      <EditorShell title="Carregando…" onBack={() => navigate("/modelos")}>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[420px] w-full" />
      </EditorShell>
    )
  }

  if (isError || !data) {
    return <NotFound />
  }

  return <EditModeInner key={data.id} modelo={data} />
}

function EditModeInner({ modelo }: { modelo: Modelo }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [nome, setNome] = useState(modelo.nome)
  const [categoria, setCategoria] = useState(modelo.categoria ?? "outros")
  const [descricao, setDescricao] = useState(modelo.descricao ?? "")
  const [tags, setTags] = useState(modelo.tags ?? "")
  const [conteudo, setConteudo] = useState(modelo.conteudo ?? "")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  const dirty =
    nome !== modelo.nome ||
    (categoria ?? "outros") !== (modelo.categoria ?? "outros") ||
    (descricao ?? "") !== (modelo.descricao ?? "") ||
    (tags ?? "") !== (modelo.tags ?? "") ||
    conteudo !== (modelo.conteudo ?? "")

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertModelo({
        id: modelo.id,
        nome: nome.trim(),
        categoria,
        descricao: descricao.trim() || null,
        tags: tags.trim() || null,
        conteudo,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelo(modelo.id) })
      queryClient.invalidateQueries({ queryKey: ["granola", "modelos"] })
    },
  })

  const usarMutation = useMutation({
    mutationFn: () => usarModelo(modelo.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelo(modelo.id) })
      queryClient.invalidateQueries({ queryKey: ["granola", "modelos"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteModelo(modelo.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola", "modelos"] })
      navigate("/modelos", { replace: true })
    },
  })

  function onSave() {
    if (nome.trim().length < 2) {
      setErrorMsg("Dê um nome ao modelo (mínimo 2 caracteres).")
      return
    }
    setErrorMsg(null)
    saveMutation.mutate()
  }

  async function onCopiar() {
    if (!conteudo) {
      setCopyFeedback("Modelo vazio — nada pra copiar ainda.")
      setTimeout(() => setCopyFeedback(null), 3000)
      return
    }
    try {
      // Tenta API moderna com text/html + text/plain (cola elegante em Word/Docs)
      const blobHtml = new Blob([conteudo], { type: "text/html" })
      const blobText = new Blob([htmlToText(conteudo)], { type: "text/plain" })
      const item = new ClipboardItem({
        "text/html": blobHtml,
        "text/plain": blobText,
      })
      await navigator.clipboard.write([item])
      setCopyFeedback("Conteúdo copiado — cole na sua peça")
      usarMutation.mutate()
    } catch {
      // Fallback: copia só texto plano
      try {
        await navigator.clipboard.writeText(htmlToText(conteudo))
        setCopyFeedback("Texto copiado (sem formatação)")
        usarMutation.mutate()
      } catch {
        setCopyFeedback("Falha ao copiar — selecione e copie manualmente")
      }
    }
    setTimeout(() => setCopyFeedback(null), 3500)
  }

  return (
    <EditorShell
      title={modelo.nome}
      subtitle={labelDeCategoria(modelo.categoria)}
      onBack={() => navigate("/modelos")}
      saveLabel={saveMutation.isPending ? "Salvando…" : dirty ? "Salvar" : "Salvo"}
      saveDisabled={!dirty || saveMutation.isPending}
      saveSuccess={saveMutation.isSuccess && !dirty}
      onSave={onSave}
      extraActions={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCopiar}
            disabled={usarMutation.isPending}
            className="gap-1.5"
            title="Copia o conteúdo formatado pra área de transferência (incrementa contador de usos)"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            Usar este modelo
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Mais ações"
                className="grid h-8 w-8 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem
                onClick={() => {
                  // Duplicar: cria novo com mesmo conteudo + " (cópia)"
                  upsertModelo({
                    nome: `${modelo.nome} (cópia)`,
                    categoria: modelo.categoria,
                    descricao: modelo.descricao,
                    tags: modelo.tags,
                    conteudo: modelo.conteudo,
                  }).then(({ id }) => {
                    queryClient.invalidateQueries({
                      queryKey: ["granola", "modelos"],
                    })
                    navigate(`/modelos/${id}`)
                  })
                }}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} /> Duplicar
              </DropdownMenuItem>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setShowDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />{" "}
                    Excluir
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      footerInfo={
        <>
          <span className="tabular-nums font-mono">v {modelo.versao}</span>
          <Sep />
          <span className="tabular-nums font-mono">
            atualizado {formatDateTime(modelo.atualizado_em ?? modelo.criado_em)}
          </span>
          <Sep />
          <span className="tabular-nums font-mono">
            {modelo.usos} {modelo.usos === 1 ? "uso" : "usos"}
          </span>
        </>
      }
    >
      <Metadata
        nome={nome}
        onNomeChange={setNome}
        categoria={categoria}
        onCategoriaChange={setCategoria}
        descricao={descricao}
        onDescricaoChange={setDescricao}
        tags={tags}
        onTagsChange={setTags}
      />

      <RichTextEditor value={conteudo} onChange={setConteudo} />

      {copyFeedback && (
        <p className="inline-flex items-center gap-1.5 rounded-card border-l-2 border-sucesso bg-sucesso/8 px-3 py-2 text-sm text-sucesso">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
          {copyFeedback}
        </p>
      )}

      {(errorMsg || saveMutation.isError) && (
        <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
          {errorMsg ||
            (saveMutation.error instanceof Error
              ? saveMutation.error.message
              : "Não foi possível salvar.")}
        </p>
      )}

      <ModeloAnexosPanel modeloId={modelo.id} anexos={modelo.anexos} />

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-normal">
              Excluir este modelo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{modelo.nome}</strong> e seus {modelo.anexos.length} anexo
              {modelo.anexos.length === 1 ? "" : "s"} serão removidos
              permanentemente. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.isError && (
            <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : "Não foi possível excluir."}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                deleteMutation.mutate()
              }}
              disabled={deleteMutation.isPending}
              className="bg-erro text-marfim hover:bg-erro/90"
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Excluir modelo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EditorShell>
  )
}

// --------------------------------------------------------------------------
// LAYOUT (compartilhado entre create/edit/notfound)
// --------------------------------------------------------------------------

interface EditorShellProps {
  title: string
  subtitle?: string
  onBack: () => void
  onSave?: () => void
  saveLabel?: string
  saveDisabled?: boolean
  saveSuccess?: boolean
  extraActions?: React.ReactNode
  footerInfo?: React.ReactNode
  children: React.ReactNode
}

function EditorShell({
  title,
  subtitle,
  onBack,
  onSave,
  saveLabel,
  saveDisabled,
  saveSuccess,
  extraActions,
  footerInfo,
  children,
}: EditorShellProps) {
  // Atalho Ctrl+S salva sem precisar tirar a mão do teclado
  useEffect(() => {
    if (!onSave) return
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        onSave?.()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onSave])

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="grid h-8 w-8 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[1.4rem] font-medium leading-tight text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate font-display text-[0.95rem] italic text-muted">
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {extraActions}
          {onSave && (
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={saveDisabled}
              className={cn(
                "gap-1.5 rounded-card",
                saveSuccess
                  ? "bg-sucesso text-marfim hover:bg-sucesso/90"
                  : "bg-dourado text-tinta hover:bg-dourado-claro hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
              )}
            >
              {saveSuccess ? (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              {saveLabel ?? "Salvar"}
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-4 px-6 py-5 lg:px-8">{children}</div>

      {footerInfo && (
        <footer className="flex flex-wrap items-center gap-1 border-t border-border bg-surface-alt px-6 py-2 text-[0.72rem] text-muted">
          {footerInfo}
        </footer>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// METADATA (nome / categoria / descricao / tags)
// --------------------------------------------------------------------------

interface MetadataProps {
  nome: string
  onNomeChange: (v: string) => void
  categoria: string
  onCategoriaChange: (v: string) => void
  descricao: string
  onDescricaoChange: (v: string) => void
  tags: string
  onTagsChange: (v: string) => void
}

function Metadata({
  nome,
  onNomeChange,
  categoria,
  onCategoriaChange,
  descricao,
  onDescricaoChange,
  tags,
  onTagsChange,
}: MetadataProps) {
  return (
    <div className="space-y-3 rounded-card border border-border bg-surface px-5 py-4">
      <div>
        <label className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-muted">
          Nome do modelo
        </label>
        <input
          type="text"
          value={nome}
          onChange={(e) => onNomeChange(e.target.value)}
          placeholder="Ex.: Petição inicial — danos morais"
          className={cn(
            "mt-1 block w-full border-0 border-b border-border bg-transparent pb-2 pt-1",
            "font-display text-[1.5rem] font-medium leading-tight text-foreground outline-none transition-colors",
            "placeholder:text-muted/50 focus:border-dourado"
          )}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr]">
        <div>
          <label className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-muted">
            Área
          </label>
          <Select
            value={categoria || "outros"}
            onValueChange={onCategoriaChange}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIAS_MODELO.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-muted">
            Tags (separadas por vírgula)
          </label>
          <Input
            value={tags}
            onChange={(e) => onTagsChange(e.target.value)}
            placeholder="trabalhista, horas extras, acordo"
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <label className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-muted">
          Descrição (resumo curto)
        </label>
        <Input
          value={descricao}
          onChange={(e) => onDescricaoChange(e.target.value)}
          placeholder="Ex.: Ação indenizatória com base em violação de direitos da personalidade."
          className="mt-1"
        />
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// HELPERS
// --------------------------------------------------------------------------

function NotFound() {
  const navigate = useNavigate()
  return (
    <EditorShell title="Modelo não encontrado" onBack={() => navigate("/modelos")}>
      <p className="rounded-card border border-border bg-surface px-5 py-12 text-center font-display italic text-lg text-muted">
        Esse modelo não existe ou foi removido.
      </p>
    </EditorShell>
  )
}

function Sep() {
  return <span className="text-muted/50">·</span>
}

/** Conversao crua HTML -> texto preservando quebras visíveis. Útil pro
 *  fallback do Copiar quando ClipboardItem com HTML não é suportado. */
function htmlToText(html: string): string {
  const tmp = document.createElement("div")
  tmp.innerHTML = html
    .replace(/<\/(p|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
  return (tmp.textContent || "").replace(/\n{3,}/g, "\n\n").trim()
}
