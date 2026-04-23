import { apiGet, apiPost } from "./client"
import type { LoginResponse, MeResponse } from "@/types/auth"

export async function fetchMe() {
  return apiGet<MeResponse>("/api/auth/me")
}

export async function postLogin(input: { username: string; password: string }) {
  return apiPost<LoginResponse>("/api/auth/login", input)
}

export async function postLogout() {
  return apiPost<{ status: "ok" }>("/api/auth/logout")
}
