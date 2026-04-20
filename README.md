# Granola CRM

CRM jurídico standalone da Valerius Assessoria. Backend Python stdlib, SQLite WAL, coleta multi-fonte de publicações (DataJud CNJ, DJEN/PCP, Selenium e-SAJ+PJe), integração Google Calendar bidirecional.

Em produção diário para o Dr. Claudio desde 2026.

---

## Sumário

- [Status atual](#status-atual)
- [Quick start](#quick-start)
- [Estrutura do projeto](#estrutura-do-projeto)
- [API — grupos de endpoints](#api--grupos-de-endpoints)
- [Banco de dados](#banco-de-dados)
- [Coleta de publicações — 3 caminhos](#coleta-de-publicações--3-caminhos)
- [Roadmap: rewrite do frontend](#roadmap-rewrite-do-frontend)
- [Setup do `frontend-v2/`](#setup-do-frontend-v2-quando-chegar-em-casa)
- [Identidade visual Valerius](#identidade-visual-valerius-tokens)
- [O que NÃO está no repo](#o-que-não-está-no-repo-e-por-quê)
- [Workflow de desenvolvimento](#workflow-de-desenvolvimento)
- [Troubleshooting](#troubleshooting)

---

## Status atual

- Backend **estável** — ~80 endpoints, 2.120 linhas em `granola/server.py`, em uso diário.
- Frontend **legado** — SPA vanilla em `frontend/index.html` (272 KB, arquivo único). **Vai ser substituído** pelo rewrite React + Vite + TS (ver [roadmap](#roadmap-rewrite-do-frontend)).
- Produto derivado: **GranolaBox** (versão pendrive USB, mora em `Projetos/GranolaBox/` na máquina do Dr. Claudio, **não está neste repo**).
- Produto irmão (fora de escopo aqui): **Vallora** — SaaS cloud multi-tenant em Cloudflare Workers+D1.

---

## Quick start

### Pré-requisitos
- **Python 3.10+**
- **Chromium / Chrome** instalado (só necessário se for usar os scrapers Selenium de e-SAJ/PJe)
- **Git**

### Clone e setup

```bash
git clone https://github.com/zovalerio/granola.git
cd granola

python -m venv .venv
source .venv/bin/activate            # Linux/Mac
# .venv\Scripts\activate             # Windows PowerShell

# Nao existe requirements.txt ainda (TODO: criar no primeiro setup funcional)
pip install selenium requests openpyxl google-auth-oauthlib google-auth google-api-python-client
```

### Rodar o backend

```bash
python -m granola
```

- Porta: **3458**
- URL: http://localhost:3458
- Primeiro boot cria `granola/data/granola.db` vazio automaticamente
- Não há seed de usuário default — o primeiro admin precisa ser criado manualmente (ver `granola/database.py::AuthDB.create_user`). TODO: adicionar script de seed.

### Testando com dados fake

1. Crie um admin pelo shell Python (usando `AuthDB.create_user`) ou hardcode um seed temporário
2. Logue em http://localhost:3458
3. Cadastre 2-3 clientes e processos via UI pra ter massa de testes

Se precisar de **banco populado realista**, peça ao Dr. Claudio um dump redacted (dados anonimizados).

---

## Estrutura do projeto

```
granola/
├── __main__.py              # Entry point: python -m granola
├── server.py                # HTTP + API REST (~80 endpoints, 2.120 linhas)
├── database.py              # Schema SQLite WAL + helpers (1.642 linhas)
├── datajud.py               # API CNJ DataJud (coleta padrao diaria)
├── djen.py                  # API DJEN/PCP (publicacoes por OAB)
├── publicacoes.py           # Scraper e-SAJ (Selenium CDP) - fallback manual
├── publicacoes_pje.py       # Scraper PJe (Selenium CDP) - fallback manual
├── gcal_sync.py             # Google Calendar OAuth2 bidirecional
└── data/                    # IGNORADO (dados reais, sigilo OAB)
    ├── granola.db
    ├── gcal_credentials.json
    ├── gcal_token.json
    └── uploads/

frontend/
└── index.html               # SPA vanilla legado - sera substituido

marketing/video/             # Pipeline Playwright pra gerar demos comerciais
├── gravar.py                # Grava video 60s cena-a-cena
├── gravar_redacted.py       # Idem com redact.js (borra nomes/CNJs)
├── redact.js                # MutationObserver + regex CNJ/nomes
└── tirar_prints_redacted.py

backfill_dedup_publicacoes.py   # Utilitario: dedup cross-fonte retroativo
corrigir_processos.py           # Utilitario: correcao manual de processos
importar_planilha.py            # Import Excel (MV Krupp.xlsx) → DB
run.bat                         # Launcher Windows
```

---

## API — grupos de endpoints

~80 endpoints, todos JSON, todos POST para mutação (convenção do backend). Auth via cookie `granola_session` ou header `Authorization: Bearer <token>`.

| Grupo | Base path | O que faz |
|---|---|---|
| Auth | `/api/auth/*` | `login`, `logout`, `me`, `change-password` |
| Clientes | `/api/granola/cliente(s)` | CRUD PF/PJ |
| Processos | `/api/granola/processo(s)` | CRUD, swap-cliente, kanban, status |
| Kanban | `/api/granola/kanban*` | Colunas customizáveis, ordem |
| Partes | `/api/granola/parte*` | Polo ativo/passivo, OAB |
| Movimentações | `/api/granola/publicacoes*`, `/movimentacoes` | Coleta multi-fonte + status/progresso/log |
| Prazos | `/api/granola/prazo(s)` | Deadlines com prioridade e alerta |
| Financeiro | `/api/granola/financeiro*`, `/gastos` | Receitas/despesas, cartão corporativo, parcelas |
| Agenda | `/api/granola/agenda*`, `/gcal*` | Google Calendar sync bidirecional |
| Documentos | `/api/granola/documento(s)` | Upload multipart com SHA256 |
| Admin | `/api/admin/*`, `/config`, `/audit`, `/pending`, `/stats` | Users, API keys, audit log, pending approvals |

Router completo: `granola/server.py` linhas 200–1965.

---

## Banco de dados

- **SQLite** em **WAL mode** (`PRAGMA journal_mode=WAL`)
- **13 tabelas principais**:
  - `users`, `sessions`, `audit_log` (auth)
  - `granola_clientes` (PF/PJ)
  - `granola_processos` (CNJ, valores, kanban_coluna)
  - `granola_partes` (autor/réu, OAB)
  - `granola_movimentacoes` com campo **`fonte`** ∈ {`datajud_auto`, `djen_auto`, `esaj_auto`, `pje_auto`, `manual`}
  - `granola_prazos`, `granola_financeiro`, `granola_agenda`, `granola_documentos`
  - `granola_kanban_colunas`, `granola_pending_edits` (workflow de aprovação p/ valores sensíveis)
  - `granola_config` (key-value: API keys DataJud, lista de OABs DJEN, últimas coletas)
- **Dedup cross-fonte**: campo `hash_dedup` em `granola_movimentacoes` — mesma publicação vinda de fontes diferentes nunca duplica.
- Schema DDL inline em `granola/database.py::init_db()`.

---

## Coleta de publicações — 3 caminhos

| Ordem | Fonte | Como funciona |
|---|---|---|
| 1 (padrão) | **DataJud CNJ** | API pública, batch multi-tribunal, ~5s pra 42 processos. Trigger diário automático no primeiro login. Defasagem 1-2 dias. |
| 2 | **DJEN/PCP** | API pública por OAB. Rate limit ≥2.5s entre requests. Configurar OABs em `granola_config`. |
| 3 (fallback) | **Selenium e-SAJ + PJe** | Chromium CDP porta 9222. Botão "Verificação Manual" roda os dois em sequência. Requer Chromium aberto. |

Configuração das chaves:
- **DataJud API key** → `granola_config.datajud_api_key`
- **OABs do DJEN** → `granola_config.djen_oabs` (JSON: `[{"numero":"372868","uf":"SP"}]`)

---

## Roadmap: rewrite do frontend

### Motivação
O `frontend/index.html` atual é um monolito vanilla de 272 KB — sem build step, sem componentes, sem router, sem type safety, sem testes. Funciona pro uso diário mas não é um "frontend de verdade" e não tem cara de produto comercial.

### Decisões (travadas)

| Item | Escolha |
|---|---|
| Framework | **React 18+** |
| Build | **Vite** |
| Linguagem | **TypeScript** |
| UI | **shadcn/ui + Tailwind CSS** |
| Router | **React Router v7** |
| Server state | **TanStack Query** |
| UI state | **Zustand** (se necessário) |
| Forms | **React Hook Form + Zod** |
| Testes | **Vitest + Testing Library** |
| Estratégia | **Big bang** — pasta nova `frontend-v2/` paralela, cutover único no final |
| Backend | **Intocado** — 100% reaproveitado |

### Fases previstas

| Fase | Escopo | Duração |
|---|---|---|
| 0 | Setup Vite + Tailwind + shadcn + tokens Valerius + ESLint/Prettier + Vitest | 1-2d |
| 1 | Auth + shell (sidebar, topbar, router, ProtectedRoute) | 2-3d |
| 2 | Dashboard + clientes | 3-4d |
| 3 | Processos + movimentações (coleta + progresso) | 5-7d |
| 4 | Prazos + kanban + documentos | 3-4d |
| 5 | Financeiro + agenda (GCal) | 3-4d |
| 6 | Admin + config | 2d |
| 7 | Cutover (build + copia `dist/` pro lugar do `frontend/`) | 1d |

**Total:** 20-27 dias úteis.

### Pós-rewrite: enxugar o backend

Após o `frontend-v2` estar em produção, remover endpoints legados não utilizados. Candidatos óbvios:
- `/publicacoes/coletar`, `/publicacoes/coletar-todos` — redundantes com `coletar-datajud` + `verificacao-manual`
- Endpoints mortos identificados durante o rewrite

**Ordem crítica: frontend primeiro, backend depois.** Enxugar antes = risco alto de quebrar o app em produção.

---

## Setup do `frontend-v2/` (quando chegar em casa)

Pré-requisito: **Node 20 LTS** instalado.

```bash
cd granola
mkdir frontend-v2 && cd frontend-v2

# Scaffold Vite + React + TS
npm create vite@latest . -- --template react-ts
npm install

# Tailwind
npm install -D tailwindcss@latest postcss autoprefixer
npx tailwindcss init -p

# shadcn/ui — preset "New York", dark mode off, alias "@/"
npx shadcn@latest init

# Fontes self-hosted (critico pra GranolaBox offline futuro)
npm install @fontsource/cormorant-garamond @fontsource/inter

# Libs de runtime
npm install react-router-dom @tanstack/react-query zustand
npm install react-hook-form zod @hookform/resolvers

# Dev deps
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Depois:
1. Configurar `vite.config.ts` com proxy `/api/*` e `/uploads/*` → `http://127.0.0.1:3458`
2. Configurar `tailwind.config.ts` com a paleta Valerius (ver [abaixo](#identidade-visual-valerius-tokens))
3. Adicionar temporariamente `http://localhost:5173` e `http://127.0.0.1:5173` em `granola/server.py` → `ALLOWED_ORIGINS` (linhas 58-63). **Reverter antes do cutover.**
4. Commit inicial na branch `feature/frontend-v2`

Plano técnico completo: (peça ao Claude pra recuperar `C:\Users\zoval\.claude\plans\me-explique-sobre-o-cozy-pebble.md` quando retomar a conversa).

---

## Identidade visual Valerius (tokens)

**Cores** (usar em `tailwind.config.ts` como `theme.extend.colors.valerius`):

```
purple.dark    #2D0A31   primary, backgrounds principais
purple.mid     #4A1942
purple.accent  #7B2D6E   hover, destaques
purple.light   #9B4D8B
gold.DEFAULT   #C9A96E   accent, CTAs, intros
gold.light     #D4BC8A
neutral.off    #F8F6F4
neutral.gray   #9A9590
neutral.text   #3D3A38
neutral.dark   #1A1A1A
```

**Fontes:**
- Display (títulos, intros): `Cormorant Garamond`
- Body: `Inter`

**Regras:**
- Proibido importar cor fora da paleta.
- Nada de creme ou verde.
- Intro padrão de qualquer peça: "Um produto Valerius" em Cormorant dourado sobre fundo roxo escuro.

Referência canônica dos tokens: `Projetos/valerius-site/style.css` (fora do repo, na máquina do Dr. Claudio).

---

## O que NÃO está no repo (e por quê)

Bloqueado pelo `.gitignore`. **Nunca commitar** nenhum destes:

| Arquivo/pasta | Motivo |
|---|---|
| `granola/data/*.db*` | Banco com dados reais de clientes — sigilo profissional OAB |
| `granola/data/gcal_*.json` | Credenciais OAuth2 Google Calendar |
| `granola/uploads/` | Documentos reais de clientes (PDFs, imagens) |
| `granola/data/chromium-profile-*/` | Sessões logadas em tribunais com certificado digital |
| `*.xlsx`, `*.xls`, `*.csv`, `*.pdf` | Planilhas/docs reais (ex: `MV Krupp.xlsx`) |
| `.env*` | Segredos de ambiente |
| `marketing/video/**` (exceto scripts `.py` e `.js`) | Vídeos com dados parcialmente redacted |
| `Integração DATAju.txt` | Prompt antigo com API key hardcoded |
| `.claude/` | Workspace local do Claude Code |

Se precisar de banco populado pra desenvolver → peça ao Dr. Claudio um **dump redacted** (schema + registros anonimizados).

---

## Workflow de desenvolvimento

### Branches
- `main` — versão em produção (nunca commitar direto)
- `feature/frontend-v2` — rewrite do frontend (longa duração)
- `feature/<escopo-curto>` — features pontuais
- `fix/<bug>` — correções

### Convenção de commits
Português, imperativo, curto (≤70 chars no título), corpo opcional:

```
adiciona endpoint /api/granola/relatorio

corrige dedup em movimentacoes DJEN quando CNJ tem zeros a esquerda

refatora AuthContext pra usar TanStack Query
```

### Pull Requests
- Criar sempre com descrição do "por que", não só do "o que"
- Linkar issue se existir
- Screenshots pra mudanças visuais

---

## Troubleshooting

| Problema | Causa provável | Solução |
|---|---|---|
| `python -m granola` dá `ModuleNotFoundError: granola` | Diretório errado | Rodar da pasta `granola/` (a pasta pai da pasta `granola/`) |
| Porta 3458 ocupada | Outra instância rodando | `netstat -ano \| grep 3458` (Win) ou `lsof -i :3458` (Mac/Linux) e matar o processo |
| Coleta Selenium trava | Chromium não está no CDP 9222 | Abrir Chromium com `--remote-debugging-port=9222` (ou usar o botão "Abrir Chromium" da UI) |
| DataJud retorna 403 | API key inválida ou expirada | Rotacionar em `granola_config.datajud_api_key` via `/api/admin/config` |
| DJEN retorna 429 | Rate limit | O código já espera ≥2.5s, mas se múltiplas instâncias rodarem, o throttle vira insuficiente |
| GCal OAuth falha | `gcal_credentials.json` ausente | Pedir ao Dr. Claudio o JSON do Google Cloud Console; copiar pra `granola/data/` |

---

## Contato

- **Dr. Claudio** (Lucas Munhoz) — product owner, advogado, uso diário
- **zovalerio** — desenvolvedor

## Licença

Privado — código proprietário Valerius Assessoria.
