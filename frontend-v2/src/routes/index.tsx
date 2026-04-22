import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { PlaceholderPage } from "@/pages/PlaceholderPage"

/**
 * Roteamento oficial do frontend-v2.
 *
 * Topologia:
 *  - `/` redireciona para `/login` (fluxo real do produto).
 *  - `/login` fica FORA do AppShell (sem sidebar/topbar).
 *  - Tudo em `/(agora|clientes|processos|...)` roda dentro do AppShell.
 *  - No Commit 4 o ramo do AppShell passa a ser envelopado por um
 *    ProtectedRoute que redireciona para /login se nao autenticado.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    element: (
      <PlaceholderPage
        title="Login"
        phase={1}
        hint="Autenticacao contra /api/auth/login entra no Commit 4 desta fase."
      />
    ),
  },
  {
    element: <AppShell />,
    children: [
      {
        path: "/agora",
        element: (
          <PlaceholderPage
            title="Agora"
            phase={1}
            hint="Home com greeting Cormorant e placeholder da Fase 2 entra no Commit 5 desta fase."
          />
        ),
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
])
