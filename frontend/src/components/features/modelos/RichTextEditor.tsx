import { useEffect } from "react"
import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extension-placeholder"
import { Typography } from "@tiptap/extension-typography"
import { Link } from "@tiptap/extension-link"
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Undo,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  /** Callback ao montar o editor — pra parent acessar comandos imperativos. */
  onEditorReady?: (editor: Editor) => void
}

/**
 * Editor inline estilo Notion baseado em Tiptap (ProseMirror).
 *
 * Features Fase 6.1:
 * - Headings H1/H2/H3, bold, italic, strike, código inline + bloco
 * - Listas ordenada/não-ordenada, bloco de citação
 * - Link
 * - Typography (curlys, em-dash, ellipsis automáticos)
 * - Placeholder quando vazio
 *
 * Anexos NÃO são embutidos no editor — vivem em painel separado da
 * ModeloEditorPage (decisão de UX: editor focado no texto, anexos como
 * recursos auxiliares clicáveis).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = "Comece a escrever sua peça aqui…",
  onEditorReady,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Mantemos os defaults; só desabilitamos se algum aliviar bundle.
      }),
      Placeholder.configure({ placeholder }),
      Typography,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-dourado underline underline-offset-2 hover:opacity-80",
        },
      }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose-sm max-w-none focus:outline-none",
          "min-h-[420px] px-6 py-5",
          // Estilos Cormorant pra titulos + Inter pro corpo, herdam pelo wrapper
          "[&_h1]:font-display [&_h1]:text-[1.75rem] [&_h1]:font-medium [&_h1]:mt-5 [&_h1]:mb-3 [&_h1]:leading-tight",
          "[&_h2]:font-display [&_h2]:text-[1.4rem] [&_h2]:font-medium [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:leading-tight",
          "[&_h3]:font-display [&_h3]:text-[1.15rem] [&_h3]:font-medium [&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:leading-tight",
          "[&_p]:font-sans [&_p]:text-[0.95rem] [&_p]:leading-relaxed [&_p]:my-2",
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2",
          "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2",
          "[&_li]:my-1",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-dourado [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:my-3 [&_blockquote]:text-muted",
          "[&_code]:font-mono [&_code]:text-[0.85em] [&_code]:rounded [&_code]:bg-surface-alt [&_code]:px-1 [&_code]:py-0.5",
          "[&_pre]:font-mono [&_pre]:bg-surface-alt [&_pre]:rounded-card [&_pre]:p-3 [&_pre]:my-3 [&_pre]:overflow-x-auto",
          "[&_pre_code]:bg-transparent [&_pre_code]:px-0",
          "[&_strong]:font-semibold",
          "[&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
          "[&_p.is-editor-empty:first-child::before]:text-muted/60",
          "[&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:h-0"
        ),
      },
    },
  })

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor)
    }
  }, [editor, onEditorReady])

  // Sincronizar quando value externo muda (ex: novo modelo carregado)
  // Sem causar loop com onUpdate (compara HTML).
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (value !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false })
    }
  }, [editor, value])

  return (
    <div className="rounded-card border border-border bg-surface">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

// --------------------------------------------------------------------------
// Toolbar
// --------------------------------------------------------------------------

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) {
    return (
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <div className="h-7 w-full animate-pulse rounded-card bg-surface-alt/50" />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-2">
      <ToolbarButton
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Título 1"
      >
        <Heading1 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Título 2"
      >
        <Heading2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Título 3"
      >
        <Heading3 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <Sep />
      <ToolbarButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Negrito (Ctrl+B)"
      >
        <Bold className="h-3.5 w-3.5" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Itálico (Ctrl+I)"
      >
        <Italic className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Tachado"
      >
        <Strikethrough className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <Sep />
      <ToolbarButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Lista com marcadores"
      >
        <List className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Lista numerada"
      >
        <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Citação"
      >
        <Quote className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <Sep />
      <ToolbarButton
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Código inline"
      >
        <Code className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("link")}
        onClick={() => {
          const previous = editor.getAttributes("link").href ?? ""
          const raw = window.prompt("Link (deixe vazio pra remover):", previous)
          if (raw === null) return
          if (raw === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run()
            return
          }
          // Valida o protocolo: bloqueia javascript:/data:/file: que poderiam
          // executar codigo. Adiciona https:// quando o user nao colocou esquema.
          const safe = sanitizeLinkUrl(raw.trim())
          if (!safe) {
            window.alert("Link inválido. Use um URL http(s) ou mailto/tel.")
            return
          }
          editor
            .chain()
            .focus()
            .extendMarkRange("link")
            .setLink({ href: safe })
            .run()
        }}
        title="Link"
      >
        <LinkIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <Sep />
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Desfazer (Ctrl+Z)"
        disabled={!editor.can().undo()}
      >
        <Undo className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Refazer (Ctrl+Y)"
        disabled={!editor.can().redo()}
      >
        <Redo className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ToolbarButton>
    </div>
  )
}

function ToolbarButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-[4px] transition-colors",
        active
          ? "bg-dourado/15 text-foreground"
          : "text-muted hover:bg-dourado/10 hover:text-foreground",
        disabled && "opacity-30 hover:bg-transparent hover:text-muted cursor-not-allowed"
      )}
    >
      {children}
    </button>
  )
}

function Sep() {
  return (
    <div className="mx-1 h-5 w-px bg-border" aria-hidden />
  )
}

/**
 * Aceita URL HTTP(S), mailto: e tel:. Bloqueia javascript:, data:, file:
 * e qualquer outro protocolo que possa executar codigo.
 *
 * Quando o user nao informa esquema (ex: "exemplo.com.br"), prefixa https://.
 * Retorna null se o URL ainda for invalido apos a tentativa.
 */
function sanitizeLinkUrl(raw: string): string | null {
  if (!raw) return null
  // Permite mailto: e tel: explicitos
  if (/^mailto:/i.test(raw) || /^tel:/i.test(raw)) return raw
  // Adiciona protocolo se faltar
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withProtocol)
    // Whitelist de protocolos seguros
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString()
    return null
  } catch {
    return null
  }
}
