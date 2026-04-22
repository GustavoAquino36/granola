import { createBrowserRouter, Navigate } from "react-router-dom"
import { PlaceholderPage } from "@/pages/PlaceholderPage"

/**
 * Roteamento oficial do frontend-v2.
 *
 * Estrategia:
 *  - `/` redireciona para `/login` (fluxo real do produto — deslogado ve login).
 *  - Rotas autenticadas ficam debaixo de um layout compartilhado (AppShell)
 *    a partir do Commit 3. Por enquanto elas usam PlaceholderPage direto.
 *  - ProtectedRoute entra no Commit 4 envelopando o AppShell.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    element: <PlaceholderPage title="Login" phase={1} hint="Autenticacao contra /api/auth/login entra no Commit 4 desta fase." />,
  },
  {
    path: "/agora",
    element: <PlaceholderPage title="Agora" phase={1} hint="Home com greeting Cormorant e placeholder da Fase 2 entra no Commit 5 desta fase." />,
  },
  {
    path: "/clientes",
    element: <PlaceholderPage title="Clientes" phase={2} />,
  },
  {
    path: "/processos",
    element: <PlaceholderPage title="Processos" phase={3} />,
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
    element: <PlaceholderPage title="Modelos" phase={6} hint="Biblioteca de pecas e contratos — ainda nao existe no backend, tabela entra numa migration dedicada antes da Fase 6." />,
  },
  {
    path: "/config",
    element: <PlaceholderPage title="Configurações" phase={6} />,
  },
  {
    path: "*",
    element: <PlaceholderPage title="404 · rota nao encontrada" phase={0} hint="Verifique o link ou volte para /agora." />,
  },
])
