import { apiGet, apiPost } from "./client"
import type { LoginResponse, MeResponse } from "@/types/auth"

export async function fetchMe() {
  // ignoreUnauthorized: 401 aqui significa "sessao invalida ou expirada" —
  // comportamento esperado quando o usuario abre o app deslogado. Sem isso,
  // entrariamos em loop com o handler global do api/client.
  return apiGet<MeResponse>("/api/auth/me", { ignoreUnauthorized: true })
}

export async function postLogin(input: { username: string; password: string }) {
  return apiPost<LoginResponse>("/api/auth/login", input)
}

export async function postLogout() {
  return apiPost<{ status: "ok" }>("/api/auth/logout")
}

/** Troca a senha do USUARIO LOGADO. Diferente do reset feito por admin
 *  via /api/admin/user/atualizar. Backend exige >= 6 caracteres. */
export async function postChangePassword(newPassword: string) {
  return apiPost<{ status: "ok" }>("/api/auth/change-password", {
    new_password: newPassword,
  })
}
