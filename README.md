# Granola CRM

CRM jurídico standalone da **Valerius Assessoria**. Pensado para advogados autônomos e escritórios pequenos.

**Tudo roda local no computador do cliente** — backend Python + frontend React + banco SQLite. Nenhuma infra externa, nenhum servidor nosso, nenhuma mensalidade. Modelo de venda: **pagamento único, posse vitalícia**.

---

## Sumário

- [Status](#status)
- [Quick start](#quick-start)
- [Estrutura](#estrutura)
- [API — grupos de endpoints](#api--grupos-de-endpoints)
- [Banco de dados](#banco-de-dados)
- [Coleta de publicações](#coleta-de-publicações)
- [Roadmap](#roadmap)
- [Identidade visual Valerius](#identidade-visual-valerius)
- [O que NÃO está no repo](#o-que-não-está-no-repo)
- [Workflow](#workflow)
- [Troubleshooting](#troubleshooting)

---

## Status

| Camada | Estado |
|---|---|
| **Backend** Python (`http.server` + SQLite WAL) | Estável — 80 endpoints, uso diário |
| **Frontend** React + Vite + TS + Tailwind v4 + shadcn/ui config | Fase 1 concluída: auth, shell, `/agora` com hero, placeholders das outras rotas |
| **GranolaBox** (derivado comercial em pendrive) | Em outro repositório, compartilha código do backend |

Stack frontend travada: React 19, Vite 8, TypeScript 6, Tailwind v4, React Router 7, TanStack Query 5, React Hook Form + Zod, Zustand (se necessário), Vitest + Testing Library (a partir da Fase 2).

---

## Quick start

Pré-requisitos:
- **Python 3.11+**
- **Node 20 LTS+**
- **Git**

### Uma vez só (primeiro setup):

```bash
# Clone
git clone https://github.com/zovalerio/granola.git
cd granola

# Backend
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate # Linux/Mac
pip install -r requirements.txt

# Frontend
cd frontend
npm install
cd ..
```

### No dia-a-dia (2 terminais):

**Terminal 1 — Backend:**
```bash
.venv\Scripts\activate
python -m granola
# -> http://localhost:3458
# admin auto-criado no primeiro boot: admin / granola2026
```

**Terminal 2 — Frontend (HMR):**
```bash
cd frontend
npm run dev
# -> http://localhost:5173
# Vite faz proxy de /api/* -> backend 3458
```

Abra `http://localhost:5173` e logue com `admin / granola2026`. A dica de credencial aparece no card de login em modo dev.

Atalho: execute `dev.bat` (Windows) e os dois terminais sobem juntos.

### Popular com dados de demonstração:

```bash
python scripts/seed_demo_data.py
```

Cria 3 clientes, 5 processos, 8 movimentações, 4 prazos (1 vencido), 6 lançamentos financeiros, 2 eventos de agenda. CPFs/CNPJs fictícios. Idempotente.

---

## Estrutura

```
granola-repo/
├── granola/                  # Backend Python (intocado até Fase 8)
│   ├── __main__.py           # Entry point: python -m granola
│   ├── server.py             # HTTP + roteador de 80 endpoints
│   ├── database.py           # SQLite WAL + schema + helpers
│   ├── datajud.py            # Coleta CNJ DataJud (padrão)
│   ├── djen.py               # Coleta DJEN/PCP por OAB
│   ├── publicacoes.py        # Fallback Selenium e-SAJ
│   ├── publicacoes_pje.py    # Fallback Selenium PJe
│   └── gcal_sync.py          # Google Calendar OAuth2
│
├── frontend/                 # React + TS + Vite + Tailwind v4
│   ├── src/
│   │   ├── api/              # Fetcher central + por modulo (auth, ...)
│   │   ├── components/       # ui/, layout/, features/
│   │   ├── lib/              # utils, query-client, auth-context, theme
│   │   ├── pages/            # LoginPage, AgoraPage, PlaceholderPage
│   │   ├── routes/           # Router + ProtectedRoute
│   │   ├── types/            # Contratos API + dominio
│   │   ├── index.css         # Tokens Brandbook v2 via @theme
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts        # proxy /api/* + /uploads/* -> :3458
│   ├── tsconfig.*.json
│   └── package.json
│
├── marketing/                # Pipeline Playwright de peças comerciais
│   └── video/
│
├── scripts/                  # Utilitários (seed, backfills, imports)
│   ├── seed_demo_data.py
│   ├── backfill_dedup_publicacoes.py
│   ├── corrigir_processos.py
│   └── importar_planilha_old.py     # one-shot MV Krupp, referência
│
├── dev.bat                   # Launcher 2-em-1 (backend + frontend)
├── run.bat                   # Launcher só-backend (produção)
├── requirements.txt
├── README.md
└── .gitignore
```

---

## API — grupos de endpoints

80 endpoints, todos JSON. Auth via cookie `granola_session` ou header `Authorization: Bearer <token>`.

| Grupo | Base path | O que faz |
|---|---|---|
| Auth | `/api/auth/*` | `login`, `logout`, `me`, `change-password` |
| Clientes | `/api/granola/cliente(s)` | CRUD PF/PJ |
| Processos | `/api/granola/processo(s)` | CRUD, swap-cliente, kanban, status |
| Kanban | `/api/granola/kanban*` | Colunas customizáveis |
| Partes | `/api/granola/parte*` | Polo ativo/passivo, OAB |
| Movimentações | `/api/granola/publicacoes*`, `/movimentacoes` | Coleta multi-fonte + status |
| Prazos | `/api/granola/prazo(s)` | Deadlines com prioridade e alerta |
| Financeiro | `/api/granola/financeiro*`, `/gastos` | Receitas, despesas, parcelas |
| Agenda | `/api/granola/agenda*`, `/gcal*` | Google Calendar bidirecional |
| Documentos | `/api/granola/documento(s)` | Upload multipart com SHA256 |
| Admin | `/api/admin/*`, `/config`, `/audit`, `/pending`, `/stats` | Users, API keys, audit log |

Router completo: [`granola/server.py`](granola/server.py) linhas 200-1965.

---

## Banco de dados

- **SQLite WAL** em `granola/data/granola.db` (criado no primeiro boot).
- **14 tabelas principais**: `users`, `sessions`, `audit_log`, `granola_clientes`, `granola_processos`, `granola_partes`, `granola_movimentacoes`, `granola_prazos`, `granola_financeiro`, `granola_agenda`, `granola_documentos`, `granola_kanban_colunas`, `granola_pending_edits`, `granola_config`, `granola_notificacoes`.
- **Dedup cross-fonte**: campo `hash_dedup` em `granola_movimentacoes` evita duplicatas de publicações vindas de fontes diferentes.
- Schema DDL inline em [`granola/database.py`](granola/database.py) função `init_db()`.

---

## Coleta de publicações

Três caminhos, em ordem de preferência:

| Ordem | Fonte | Como |
|---|---|---|
| 1 (padrão) | **DataJud CNJ** | API pública, batch multi-tribunal, ~5s para 42 processos. Trigger diário no primeiro login. |
| 2 | **DJEN/PCP** | API pública por OAB (`comunicaapi.pje.jus.br`). Throttle ≥2.5s. Configurar OABs em `granola_config.djen_oabs`. |
| 3 (fallback) | **Selenium e-SAJ + PJe** | Chromium CDP porta 9222. Botão "Verificação Manual" da UI. Requer certificado digital. |

Configuração:
- **DataJud API key** → `granola_config.datajud_api_key`
- **OABs do DJEN** → `granola_config.djen_oabs` JSON: `[{"numero":"372868","uf":"SP"}]`

Se o DataJud/DJEN não trouxerem uma publicação esperada, o botão "Verificar" ao lado do processo faz Selenium em e-SAJ + PJe em sequência.

---

## Roadmap

Rewrite do frontend em pastas paralelas com cutover único. Backend intocado até Fase 8.

| Fase | Escopo | Estado |
|---|---|---|
| 0 | Setup Vite + Tailwind v4 + shadcn + tokens Valerius | ✅ Concluída |
| 1 | Auth + shell + `/agora` hero + placeholders | ✅ Concluída |
| 2 | Dashboard real + CRUD Clientes | Próxima |
| 3 | Processos + movimentações (coleta + progresso) | |
| 4 | Prazos + kanban + documentos | |
| 5 | Financeiro + agenda (GCal) | |
| 6 | Admin + config | |
| 7 | Cutover: `npm run build` → `frontend/dist/`, apontar `STATIC_DIR` do backend, remover CORS de `:5173` | |
| 8 | Enxugar backend: endpoints legados, refactor de server.py | |

Possível Fase 9: embrulhar em **Tauri** pra virar `.exe` com janela nativa. Adicionável sem refazer nada do React.

---

## Identidade visual Valerius

Brandbook edição 02 (abril 2026). Tokens aplicados em [`frontend/src/index.css`](frontend/src/index.css) via `@theme`.

**Paleta** (proibido sair dela):

| Cor | Hex | Uso |
|---|---|---|
| Roxo Granola | `#332030` | Sidebar, botões escuros, fundos de marca |
| Dourado | `#C69E5B` | CTA primária, destaques, 1 por tela |
| Marfim | `#F0ECE8` | Fundo do app (light) |
| Tinta | `#2A1829` | Texto padrão |
| Roxo Profundo | `#1E1220` | Fundo dark mode |
| Roxo Claro | `#4A3445` | Hover, destaques secundários |
| Fumaça | `#6B6675` | Texto muted |
| Sucesso | `#3A7D44` | Status ok, confirmação |
| Alerta | `#C47A3D` | Prazo próximo |
| Erro | `#A83A3A` | Prazo fatal, destrutivo |

**Fontes** (self-hosted via `@fontsource`):
- **Display**: Cormorant Garamond (títulos, greetings em itálico dourado)
- **Body**: Inter
- **Mono**: JetBrains Mono (CNJ, valores monetários, datas)

**Regras de ouro**:
- Cor sozinha nunca comunica status. Sempre **dot + texto**.
- Dourado é pontuação, não base. 1 por tela. Regra 60/30/10 (Marfim / Roxo / Dourado).
- Sem branco puro `#FFFFFF` em áreas editoriais.
- Sem gradientes, sem glassmorphism.
- Proibido usar cor fora da paleta.

---

## O que NÃO está no repo

Bloqueado pelo `.gitignore`. Nunca commitar:

| Arquivo / pasta | Motivo |
|---|---|
| `granola/data/*.db*` | Dados reais de clientes — sigilo OAB |
| `granola/data/gcal_*.json` | OAuth2 Google Calendar |
| `granola/data/uploads/` | Documentos reais |
| `granola/data/chromium-profile-*/` | Sessões logadas em tribunais |
| `*.xlsx`, `*.csv`, `*.pdf`, `*.docx` | Planilhas e documentos reais |
| `.env*` | Segredos |
| `node_modules/`, `dist/`, `.venv/` | Regeneráveis, não versiona |
| `marketing/video/**` (exceto scripts) | Vídeos brutos |

Para banco populado, use [`scripts/seed_demo_data.py`](scripts/seed_demo_data.py).

---

## Workflow

### Branches
- `main` — versão em produção (nunca commitar direto)
- `feature/frontend-v2` — rewrite em andamento (será renomeada/mergeada ao fim da Fase 7)
- `feature/<escopo>` — features pontuais
- `fix/<bug>` — correções

### Commits
Português, imperativo, ≤70 chars no título. Exemplos:

```
adiciona endpoint /api/granola/relatorio

corrige dedup em movimentacoes DJEN quando CNJ tem zeros a esquerda

refatora AuthContext pra usar TanStack Query
```

### Pull Requests
- Descrição foca no **por quê**, não só no **o quê**.
- Screenshots para mudanças visuais.
- CI (quando existir) precisa passar: `tsc --noEmit` + `eslint` + testes.

---

## Troubleshooting

| Problema | Causa | Solução |
|---|---|---|
| `ModuleNotFoundError: granola` | Diretório errado | Rodar da raiz do repo |
| Porta 3458 ocupada | Outra instância | `netstat -ano \| findstr 3458` (Win) ou `lsof -i :3458` e matar |
| Login no frontend retorna erro de rede | Backend offline | Subir `python -m granola` antes do Vite |
| Tela branca após login | Cache de cookie antigo | DevTools > Application > Cookies > remove `granola_session` e tente de novo |
| `npm run dev` diz EADDRINUSE :5173 | Vite já rodando em outro shell | `taskkill /F /IM node.exe` (Win) e reinicie |
| Coleta Selenium trava | Chromium não está no CDP 9222 | Abrir Chromium com `--remote-debugging-port=9222` ou usar botão "Abrir Chromium" da UI |
| DataJud retorna 403 | API key inválida | Rotacionar `granola_config.datajud_api_key` via `/api/admin/config` |
| GCal OAuth falha | `gcal_credentials.json` ausente | Pedir JSON do Google Cloud Console ao Dr. Claudio |

---

## Contato

- **Dr. Claudio** (Lucas Munhoz) — product owner, advogado, uso diário
- **zovalerio** — mantenedor original
- Dev ativo — ver `git log`

## Licença

Privado — código proprietário Valerius Assessoria. Não distribuir.
