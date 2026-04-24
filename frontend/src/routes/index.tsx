import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { AgoraPage } from "@/pages/AgoraPage"
import { ClienteDetailPage } from "@/pages/ClienteDetailPage"
import { ClientesPage } from "@/pages/ClientesPage"
import { LoginPage } from "@/pages/LoginPage"
import { PlaceholderPage } from "@/pages/PlaceholderPage"
import { ProcessosPage } from "@/pages/ProcessosPage"
import { ProtectedRoute } from "./ProtectedRoute"

/**
 * Roteamento oficial do frontend-v2.
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
            element: <PlaceholderPage title="Processo :id" phase={3} />,
          },
          {
            path: "/agenda",
            element: <PlaceholderPage title="Agenda" phase={5} />,
          },
          {
            path: "/financeiro",
            element: <PlaceholderPage title="Financeiro" phase={5} />,
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
            element: <PlaceholderPage title="Configurações" phase={6} />,
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
