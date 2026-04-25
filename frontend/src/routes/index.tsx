import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { AgendaPage } from "@/pages/AgendaPage"
import { AgoraPage } from "@/pages/AgoraPage"
import { ClienteDetailPage } from "@/pages/ClienteDetailPage"
import { ClientesPage } from "@/pages/ClientesPage"
import { ConfigPage } from "@/pages/ConfigPage"
import { DocumentosPage } from "@/pages/DocumentosPage"
import { FinanceiroPage } from "@/pages/FinanceiroPage"
import { KanbanPage } from "@/pages/KanbanPage"
import { LoginPage } from "@/pages/LoginPage"
import { PlaceholderPage } from "@/pages/PlaceholderPage"
import { PrazosPage } from "@/pages/PrazosPage"
import { ProcessoDetailPage } from "@/pages/ProcessoDetailPage"
import { ProcessosPage } from "@/pages/ProcessosPage"
import { ProtectedRoute } from "./ProtectedRoute"

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
          {
            path: "/agora",
            element: <AgoraPage />,
          },
          {
            path: "/clientes",
            element: <ClientesPage />,
          },
          {
            path: "/clientes/:id",
            element: <ClienteDetailPage />,
          },
          {
            path: "/processos",
            element: <ProcessosPage />,
          },
          {
            path: "/processos/:id",
            element: <ProcessoDetailPage />,
          },
          {
            path: "/kanban",
            element: <KanbanPage />,
          },
          {
            path: "/prazos",
            element: <PrazosPage />,
          },
          {
            path: "/documentos",
            element: <DocumentosPage />,
          },
          {
            path: "/agenda",
            element: <AgendaPage />,
          },
          {
            path: "/financeiro",
            element: <FinanceiroPage />,
          },
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
          {
            path: "/modelos",
            element: (
              <PlaceholderPage
                title="Modelos"
                phase={6}
                hint="Biblioteca de pecas e contratos — tabela ainda nao existe no backend, migration entra antes da Fase 6."
              />
            ),
          },
          {
            path: "/config",
            element: <ConfigPage />,
          },
          {
            path: "*",
            element: (
              <PlaceholderPage
                title="404 · rota nao encontrada"
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
