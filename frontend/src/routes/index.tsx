import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { LoginPage } from "@/pages/LoginPage"
import { PlaceholderPage } from "@/pages/PlaceholderPage"
import { Skeleton } from "@/components/ui/skeleton"
import { ProtectedRoute } from "./ProtectedRoute"

/**
 * Code-splitting (Fase 6.5): cada page vira chunk separado via lazy().
 * Resultado: first-load do app cai dramaticamente porque o bundle gigante
 * (~1.3MB) só carrega o necessário pra rota visitada. Tiptap (~400KB) só
 * baixa quando o usuario abre /modelos/:id.
 *
 * LoginPage e PlaceholderPage ficam eager — sao usadas no boot/erro e
 * baixar elas async causaria flash no caminho mais comum (login).
 */
const AgendaPage = lazy(() =>
  import("@/pages/AgendaPage").then((m) => ({ default: m.AgendaPage }))
)
const AgoraPage = lazy(() =>
  import("@/pages/AgoraPage").then((m) => ({ default: m.AgoraPage }))
)
const ClienteDetailPage = lazy(() =>
  import("@/pages/ClienteDetailPage").then((m) => ({
    default: m.ClienteDetailPage,
  }))
)
const ClientesPage = lazy(() =>
  import("@/pages/ClientesPage").then((m) => ({ default: m.ClientesPage }))
)
const ConfigPage = lazy(() =>
  import("@/pages/ConfigPage").then((m) => ({ default: m.ConfigPage }))
)
const DocumentosPage = lazy(() =>
  import("@/pages/DocumentosPage").then((m) => ({ default: m.DocumentosPage }))
)
const FinanceiroPage = lazy(() =>
  import("@/pages/FinanceiroPage").then((m) => ({ default: m.FinanceiroPage }))
)
const KanbanPage = lazy(() =>
  import("@/pages/KanbanPage").then((m) => ({ default: m.KanbanPage }))
)
const ModeloEditorPage = lazy(() =>
  import("@/pages/ModeloEditorPage").then((m) => ({
    default: m.ModeloEditorPage,
  }))
)
const ModelosPage = lazy(() =>
  import("@/pages/ModelosPage").then((m) => ({ default: m.ModelosPage }))
)
const PrazosPage = lazy(() =>
  import("@/pages/PrazosPage").then((m) => ({ default: m.PrazosPage }))
)
const ProcessoDetailPage = lazy(() =>
  import("@/pages/ProcessoDetailPage").then((m) => ({
    default: m.ProcessoDetailPage,
  }))
)
const ProcessosPage = lazy(() =>
  import("@/pages/ProcessosPage").then((m) => ({ default: m.ProcessosPage }))
)

/**
 * Fallback discreto enquanto o chunk da page baixa.
 * Mantem layout estavel (header skeleton + corpo skeleton) pra evitar
 * jumps quando a page real renderiza.
 */
function PageLoading() {
  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-64 w-full rounded-card" />
    </div>
  )
}

function lazyPage(node: React.ReactNode) {
  return <Suspense fallback={<PageLoading />}>{node}</Suspense>
}

/**
 * Roteamento oficial do frontend.
 *
 * Topologia:
 *  - `/` redireciona para `/login`.
 *  - `/login` fica FORA do AppShell (sem sidebar/topbar) e fora do ProtectedRoute.
 *  - Tudo em `/(agora|clientes|processos|...)` esta dentro do ProtectedRoute -> AppShell.
 *    Nao autenticado -> redireciona para /login com ?next=<path-atual>.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/agora", element: lazyPage(<AgoraPage />) },
          { path: "/clientes", element: lazyPage(<ClientesPage />) },
          { path: "/clientes/:id", element: lazyPage(<ClienteDetailPage />) },
          { path: "/processos", element: lazyPage(<ProcessosPage />) },
          { path: "/processos/:id", element: lazyPage(<ProcessoDetailPage />) },
          { path: "/kanban", element: lazyPage(<KanbanPage />) },
          { path: "/prazos", element: lazyPage(<PrazosPage />) },
          { path: "/documentos", element: lazyPage(<DocumentosPage />) },
          { path: "/agenda", element: lazyPage(<AgendaPage />) },
          { path: "/financeiro", element: lazyPage(<FinanceiroPage />) },
          {
            path: "/gastos",
            element: (
              <PlaceholderPage
                title="Gastos sócios"
                phase={6}
                hint="Squad-only — gestão de gastos pessoais por sócio. Habilitado após o lançamento da SKU Squad."
              />
            ),
          },
          { path: "/modelos", element: lazyPage(<ModelosPage />) },
          { path: "/modelos/:id", element: lazyPage(<ModeloEditorPage />) },
          { path: "/config", element: lazyPage(<ConfigPage />) },
          {
            path: "*",
            element: (
              <PlaceholderPage
                title="404 · rota não encontrada"
                phase={0}
                hint="Verifique o link ou volte para /agora."
              />
            ),
          },
        ],
      },
    ],
  },
])
