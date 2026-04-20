"""
Granola — Pesquisa de Publicacoes PJe (TRT2/TRT15/TRF3)
Coleta movimentacoes via PJe Consulta Processual.

Fluxo por tribunal (baseado no roteiro PJe):
  1. Abre Chromium porta 9223 (perfil dedicado PJe)
  2. Login PDPJ (login.seam):
     - Operador clica "Entrar com PDPJ"
     - Insere CPF + senha (30s)
     - Valida 2FA via app (30s)
  3. Apos login, redireciona ao painel (usuario-externo)
  4. Navega a consulta processual para estabelecer sessao
  5. Para cada processo:
     a. Tenta API REST (consulta-api) — rapido, sem captcha
     b. Fallback: navega a detalhe-processo/{numero}/1 — extrai via DOM
  6. Salva novas movimentacoes no banco

SSO PDPJ compartilhado: login em um tribunal serve para todos.
Chromium porta 9223 com perfil dedicado PJe.
"""
import hashlib
import json
import logging
import os
import re
import subprocess
import threading
import time
from datetime import datetime, date
from pathlib import Path

import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from granola.database import get_connection

log = logging.getLogger("granola.publicacoes_pje")

# ============================================================
#  Configuracao por tribunal (URLs do roteiro PJe)
# ============================================================
CDP_PORT = 9222  # Compartilha com Sardela/e-SAJ (porta unica, abas separadas)
CHROMIUM_PATH = os.path.expandvars(r"%LOCALAPPDATA%\Chromium\Application\chrome.exe")
SLEEP_ENTRE_PROCESSOS = 0.8

# Tempo de espera para autenticacao humana (em segundos)
TIMEOUT_LOGIN = 60       # 60s para credenciais (CPF + senha)
TIMEOUT_2FA = 60         # 60s para validacao 2FA
TIMEOUT_CAPTCHA = 45     # 45s para resolver captcha
TIMEOUT_AUTH_TOTAL = 180 # 3 min de espera total para login (antes 90s — muito curto)

PJE_CONFIG = {
    "TRT2": {
        "base_url": "https://pje.trt2.jus.br",
        "consulta_api": "https://pje.trt2.jus.br/pje-consulta-api/api",
        "consulta_url": "https://pje.trt2.jus.br/consultaprocessual/",
        # detalhe_url aceita formatacao com {instancia} (1 ou 2)
        "detalhe_url": "https://pje.trt2.jus.br/consultaprocessual/detalhe-processo/{numero}/{instancia}",
        "login_url_1g": "https://pje.trt2.jus.br/primeirograu/login.seam",
        "login_url_2g": "https://pje.trt2.jus.br/segundograu/login.seam",
        "painel_url": "https://pje.trt2.jus.br/pjekz/painel/usuario-externo",
        "justica": "5", "tribunal": "02",
    },
    "TRT15": {
        "base_url": "https://pje.trt15.jus.br",
        "consulta_api": "https://pje.trt15.jus.br/pje-consulta-api/api",
        "consulta_url": "https://pje.trt15.jus.br/consultaprocessual/",
        "detalhe_url": "https://pje.trt15.jus.br/consultaprocessual/detalhe-processo/{numero}/{instancia}",
        "login_url_1g": "https://pje.trt15.jus.br/primeirograu/login.seam",
        "login_url_2g": "https://pje.trt15.jus.br/segundograu/login.seam",
        "painel_url": "https://pje.trt15.jus.br/pjekz/painel/usuario-externo",
        "justica": "5", "tribunal": "15",
    },
    "TRF3": {
        # TRF3 tem subdominios distintos para 1g e 2g (pje1g / pje2g)
        "base_url_1g": "https://pje1g.trf3.jus.br",
        "base_url_2g": "https://pje2g.trf3.jus.br",
        "consulta_api_1g": "https://pje1g.trf3.jus.br/pje-consulta-api/api",
        "consulta_api_2g": "https://pje2g.trf3.jus.br/pje-consulta-api/api",
        "consulta_url_1g": "https://pje1g.trf3.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
        "consulta_url_2g": "https://pje2g.trf3.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
        "detalhe_url": None,  # TRF3 usa PJe legado, sem padrao de detalhe moderno
        "login_url_1g": "https://pje1g.trf3.jus.br/pje/login.seam",
        "login_url_2g": "https://pje2g.trf3.jus.br/pje/login.seam",
        "painel_url": "https://pje1g.trf3.jus.br/pje/painel/usuario-externo",
        "justica": "4", "tribunal": "03",
    },
}


def _detectar_grau_pje(fase: str | None) -> str:
    """Decide '1' ou '2' grau PJe com base na fase do processo."""
    if not fase:
        return "1"
    f = fase.lower()
    if any(k in f for k in ("recurso", "acord", "segundo grau", "2g", "2o grau", "apela", "ro ", "ror")):
        return "2"
    return "1"


def _cfg(tribunal: str, grau: str, key: str):
    """
    Helper para pegar config com sufixo de grau (_1g/_2g), com fallback para chave simples.
    Usado por TRF3 (que tem URLs distintas por grau) e TRTs (que tem login distinto por grau).
    """
    cfg = PJE_CONFIG[tribunal]
    sufixo = "_2g" if grau == "2" else "_1g"
    return cfg.get(f"{key}{sufixo}") or cfg.get(key)

# Ordem de coleta — TRT2 primeiro (login principal), depois SSO para os outros
ORDEM_TRIBUNAIS = ["TRT2", "TRT15", "TRF3"]

# Regex: detecta justica (4=Federal, 5=Trabalho) e tribunal no CNJ
PJE_RE = re.compile(r"(\d{7}-\d{2}\.\d{4})\.([45])\.(\d{2})\.\d{4}")

# Controle
_last_run_date_pje: date | None = None
_running_pje = False

# Progresso em tempo real (atualizado durante coleta)
_progresso_pje = {
    "em_andamento": False,
    "tribunal_atual": None,
    "processo_atual": None,
    "processo_atual_titulo": None,
    "index": 0,
    "total": 0,
    "novas": 0,
    "erros": 0,
    "status": "",
    "etapa": "",  # "login", "coletando", "finalizado"
}


def get_progresso_pje() -> dict:
    """Retorna progresso em tempo real da coleta PJe."""
    return dict(_progresso_pje)


def _atualizar_progresso(**kwargs):
    """Atualiza progresso em tempo real."""
    _progresso_pje.update(kwargs)


# Reusa as funções de normalização/hash do módulo e-SAJ para manter 1 única
# definição de "publicação igual" em todo o Granola.
# Também reusa o resolvedor de chromedriver (fix para mismatch de versão do cache)
# e o log buffer compartilhado (mesmo feed para eSAJ + PJe na UI).
from granola.publicacoes import (  # noqa: E402
    _hash_mov,
    _normalize_text,
    _normalize_date,
    _resolve_chromedriver_path,
    _get_chromium_version_via_cdp,
    append_log,
)


# ============================================================
#  Pause / Resume — threading.Event independente para PJe
# ============================================================
# PJe tem seu próprio pause_event para permitir pausar só um dos dois módulos
# (o operador pode querer pausar PJe enquanto a coleta e-SAJ continua rodando,
# por exemplo se uma aba PJe travou mas a aba e-SAJ está ok).
_pause_event_pje = threading.Event()  # set = pausado


def pause_pje() -> None:
    _pause_event_pje.set()
    append_log("pje", "warn", "Coleta PJe pausada pelo operador")
    _atualizar_progresso(status="Pausado pelo operador", etapa="pausado")


def resume_pje() -> None:
    _pause_event_pje.clear()
    append_log("pje", "info", "Coleta PJe retomada")
    _atualizar_progresso(status="Retomando...", etapa="coletando")


def is_paused_pje() -> bool:
    return _pause_event_pje.is_set()


def _wait_if_paused_pje() -> None:
    """Bloqueia enquanto a coleta PJe estiver pausada (polling de 0.5s)."""
    while _pause_event_pje.is_set():
        time.sleep(0.5)


def _tribunal_from_cnj(numero_cnj: str) -> str | None:
    """Detecta tribunal PJe pelo numero CNJ (.5.02.=TRT2, .5.15.=TRT15, .4.03.=TRF3)."""
    m = PJE_RE.search(numero_cnj)
    if not m:
        return None
    justica = m.group(2)  # "4" ou "5"
    tt = m.group(3)       # "02", "15", "03"
    for key, cfg in PJE_CONFIG.items():
        if cfg["justica"] == justica and cfg["tribunal"] == tt:
            return key
    return None


# ============================================================
#  Chromium 9223 (perfil PJe)
# ============================================================
def _chromium_is_running() -> bool:
    try:
        import urllib.request
        req = urllib.request.Request(f"http://127.0.0.1:{CDP_PORT}/json/version")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def _ensure_chromium() -> bool:
    """Verifica se Chromium esta rodando na porta 9222 (compartilhado com Sardela/e-SAJ)."""
    if _chromium_is_running():
        return True

    # Se Sardela/e-SAJ nao abriu, tenta iniciar Chromium
    if not Path(CHROMIUM_PATH).exists():
        log.error("Chromium nao encontrado: %s", CHROMIUM_PATH)
        return False

    log.info("Abrindo Chromium (porta %d)...", CDP_PORT)
    subprocess.Popen(
        [
            CHROMIUM_PATH,
            f"--remote-debugging-port={CDP_PORT}",
            "--no-first-run",
            "--disable-default-apps",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(15):
        time.sleep(1)
        if _chromium_is_running():
            log.info("Chromium pronto (porta %d)", CDP_PORT)
            return True
    log.error("Chromium nao respondeu na porta %d", CDP_PORT)
    return False


def _get_driver() -> tuple[webdriver.Chrome | None, str | None]:
    """
    Conecta ao Chromium via CDP e abre aba dedicada _pje (nao interfere com Sardela/e-SAJ).

    Retorna (driver, erro). Em sucesso: (driver, None). Em falha: (None, "mensagem").

    Reusa _resolve_chromedriver_path() do módulo e-SAJ para tratar mismatch do cache
    do Selenium Manager (chromedriver cacheado com versão mais nova que o Chromium).
    """
    opts = Options()
    opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{CDP_PORT}")

    def _finalize(driver: webdriver.Chrome) -> tuple[webdriver.Chrome, None]:
        try:
            driver.execute_cdp_cmd("Emulation.setFocusEmulationEnabled", {"enabled": True})
        except Exception:
            pass
        # Abrir aba dedicada PJe — nao mexe nas abas do Sardela/e-SAJ
        driver.execute_script("window.open('about:blank', '_pje_coleta')")
        driver.switch_to.window(driver.window_handles[-1])
        return driver, None

    # Tentativa 1: chromedriver do cache compatível com o Chromium rodando
    driver_path = _resolve_chromedriver_path()
    if driver_path:
        try:
            log.info("Usando chromedriver do cache: %s", driver_path)
            service = Service(executable_path=driver_path)
            driver = webdriver.Chrome(service=service, options=opts)
            return _finalize(driver)
        except Exception as e:
            log.warning("Chromedriver do cache falhou (%s) — tentando Selenium Manager", e)

    # Tentativa 2: Selenium Manager com browser_version forçado (baixa compatível)
    chrome_ver = _get_chromium_version_via_cdp()
    if chrome_ver:
        try:
            opts2 = Options()
            opts2.add_experimental_option("debuggerAddress", f"127.0.0.1:{CDP_PORT}")
            opts2.browser_version = chrome_ver
            driver = webdriver.Chrome(options=opts2)
            return _finalize(driver)
        except Exception as e:
            log.warning("Selenium Manager com browser_version=%s falhou: %s", chrome_ver, e)

    # Tentativa 3: Selenium Manager default (propaga erro real)
    try:
        driver = webdriver.Chrome(options=opts)
        return _finalize(driver)
    except Exception as e:
        msg = str(e).split("Stacktrace")[0].strip()
        log.error("Erro conectando ao Chromium: %s", msg)
        return None, msg


# ============================================================
#  Helpers de espera ATIVA (substituem sleeps fixos)
# ============================================================
# Por que existem: sleeps fixos bloqueiam pelo tempo inteiro mesmo quando a
# página já carregou. Usando polling curto (200-500ms) saímos assim que a
# condição for satisfeita — no melhor caso lag ~= 0.2s, no pior caso == timeout.
# Isso reduz o tempo de coleta PJe drasticamente (TRF3 estava com ~17s de
# sleeps fixos por processo).

def _wait_dom_ready(driver, timeout: float = 8.0, poll: float = 0.2) -> bool:
    """Aguarda document.readyState == 'complete'. Retorna True se pronto dentro do timeout."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            if driver.execute_script("return document.readyState") == "complete":
                return True
        except Exception:
            pass
        time.sleep(poll)
    return False


def _wait_url_change(driver, from_url: str, timeout: float = 8.0, poll: float = 0.3) -> bool:
    """Aguarda a URL mudar de `from_url` (útil pra detectar fim de postback Seam)."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            if (driver.current_url or "") != from_url:
                return True
        except Exception:
            pass
        time.sleep(poll)
    return False


def _wait_element_visible(driver, selectors: list[str], timeout: float = 8.0, poll: float = 0.25) -> bool:
    """
    Aguarda pelo menos um dos seletores CSS estar visível (offsetParent != null).
    Muito mais eficiente que sleep fixo quando você sabe o que a página precisa mostrar.
    """
    script = """
        var sels = arguments[0];
        for (var i = 0; i < sels.length; i++) {
            var el = document.querySelector(sels[i]);
            if (el && el.offsetParent !== null) return true;
        }
        return false;
    """
    end = time.time() + timeout
    while time.time() < end:
        try:
            if driver.execute_script(script, selectors):
                return True
        except Exception:
            pass
        time.sleep(poll)
    return False


def _has_captcha_visible(driver) -> bool:
    """
    Detecta captcha VISÍVEL via querySelector — mais preciso que buscar substring
    "captcha" em driver.page_source (que dispara falso positivo se a palavra
    aparecer em scripts, CSS classes, metadados, etc.)
    """
    try:
        return driver.execute_script("""
            var sels = [
                'img[src*="captcha" i]',
                'img[id*="captcha" i]',
                'input[id*="captcha" i]',
                'input[name*="captcha" i]',
                'label[for*="captcha" i]',
                'div.g-recaptcha',
                'iframe[src*="recaptcha"]',
                'iframe[src*="hcaptcha"]',
            ];
            for (var i = 0; i < sels.length; i++) {
                var el = document.querySelector(sels[i]);
                if (el && el.offsetParent !== null) return true;
            }
            return false;
        """)
    except Exception:
        return False


def _wait_captcha_resolved(driver, timeout: float = 45.0, poll: float = 0.5) -> bool:
    """
    Se detectar captcha, aguarda em POLLING até ser resolvido ou timeout.

    Antes: `if page_source contains "captcha": time.sleep(45)` → bloqueava 45s
    mesmo quando o operador resolvia em 3s, E disparava falso positivo sempre
    que a palavra "captcha" aparecia em qualquer lugar do HTML/JS/CSS.

    Agora: detecta elemento visível, aguarda ele sumir (polling de 500ms).

    Retorna True se nunca havia captcha ou se foi resolvido, False em timeout.
    """
    if not _has_captcha_visible(driver):
        return True
    log.info("Captcha detectado — aguardando resolução humana (até %.0fs)...", timeout)
    start = time.time()
    end = start + timeout
    while time.time() < end:
        if not _has_captcha_visible(driver):
            log.info("Captcha resolvido após %.1fs", time.time() - start)
            return True
        time.sleep(poll)
    log.warning("Timeout aguardando captcha (%.0fs)", timeout)
    return False


# ============================================================
#  Login PDPJ e criacao de sessao
# ============================================================
def _is_authenticated(url: str) -> bool:
    """Verifica se a URL indica autenticacao bem-sucedida."""
    auth_indicators = [
        "painel", "usuario-externo", "consultaprocessual", "detalhe-processo",
        "ConsultaProcesso", "ConsultaPublica", "ConsultaDocumento",  # TRF3 PJe legado
    ]
    login_indicators = ["login.seam", "auth/realms", "acesso-negado", "sso.cloud", "Bad Request"]
    # Se contem indicador de auth e nao contem indicador de login
    if any(x in url for x in auth_indicators):
        return True
    if any(x in url for x in login_indicators):
        return False
    # URL desconhecida — provavelmente autenticado
    return True


def _login_tribunal(driver, tribunal: str, grau: str = "1") -> bool:
    """
    Login PDPJ para um tribunal + grau (1g/2g).

    Roteiro:
      1. Navega a login.seam do tribunal (primeirograu/segundograu)
      2. Operador clica "Entrar com PDPJ"
      3. Insere CPF + senha → ENTRAR
      4. Valida 2FA via app → VALIDAR
      5. Redireciona ao painel do tribunal

    Se PDPJ SSO ja ativo (login anterior), redireciona automaticamente.
    """
    login_url = _cfg(tribunal, grau, "login_url")
    log.info("[%s/%sg] Abrindo login: %s", tribunal, grau, login_url[:80])
    driver.get(login_url)
    # Aguarda DOM pronto (polling curto) em vez de sleep fixo de 3s
    _wait_dom_ready(driver, timeout=8)

    # Verificar se SSO ja redirecionou (login automatico de tribunal anterior)
    current = driver.current_url
    if _is_authenticated(current):
        log.info("[%s] SSO PDPJ ativo — ja autenticado (URL: %s)", tribunal, current[:60])
        return True

    # Aguardar autenticacao humana:
    # - 30s para credenciais (CPF + senha + clicar ENTRAR)
    # - 30s para 2FA (codigo do app + clicar VALIDAR)
    log.info("[%s] Aguardando autenticacao PDPJ (ate %ds)...", tribunal, TIMEOUT_AUTH_TOTAL)
    start = time.time()
    while time.time() - start < TIMEOUT_AUTH_TOTAL:
        try:
            url = driver.current_url
            if _is_authenticated(url):
                elapsed = time.time() - start
                log.info("[%s] Login detectado apos %.0fs (URL: %s)", tribunal, elapsed, url[:60])
                return True
        except Exception:
            pass
        time.sleep(2)

    # Ultima verificacao
    try:
        url = driver.current_url
        if _is_authenticated(url):
            return True
    except Exception:
        pass

    log.warning("[%s] Timeout de autenticacao PDPJ (%ds)", tribunal, TIMEOUT_AUTH_TOTAL)
    return False


def _create_session_from_driver(driver, tribunal: str, grau: str = "1") -> requests.Session | None:
    """
    Apos login, navega a consulta processual e extrai cookies para sessao requests.

    Roteiro: apos login → painel → clicar binoculo → consulta processual.
    No codigo, navegamos direto para a URL de consulta.
    """
    consulta_url = _cfg(tribunal, grau, "consulta_url")

    # Navegar a consulta processual para estabelecer cookies de sessao
    log.info("[%s/%sg] Abrindo consulta: %s", tribunal, grau, consulta_url[:60])
    driver.get(consulta_url)
    # Aguarda DOM pronto (polling curto) em vez de sleep fixo de 3s
    _wait_dom_ready(driver, timeout=8)

    # Verificar se ainda autenticado
    current = driver.current_url
    if not _is_authenticated(current):
        log.warning("[%s] Perdeu autenticacao ao navegar para consulta", tribunal)
        return None

    # Extrair cookies → sessao requests
    session = requests.Session()
    for c in driver.get_cookies():
        session.cookies.set(
            c["name"], c["value"],
            domain=c.get("domain", ""), path=c.get("path", "/"),
        )

    session.headers.update({
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "User-Agent": driver.execute_script("return navigator.userAgent"),
    })

    log.info("[%s] Sessao criada (%d cookies)", tribunal, len(session.cookies))
    return session


# ============================================================
#  API — Busca de processo e movimentacoes
# ============================================================
def _buscar_processo_id(session, numero_cnj: str, tribunal: str, grau: str = "1") -> int | None:
    """Busca o ID interno do processo pelo numero CNJ via consulta API."""
    consulta_api = _cfg(tribunal, grau, "consulta_api")
    numero_limpo = re.sub(r'[^0-9.-]', '', numero_cnj)

    # Tentar multiplos endpoints da API de consulta
    endpoints = [
        f"{consulta_api}/processos/dadosbasicos/{numero_limpo}",
        f"{consulta_api}/processos/{numero_limpo}",
    ]

    for url in endpoints:
        try:
            r = session.get(url, timeout=15)
            if not r.ok:
                log.debug("[%s] API %s retornou %d", tribunal, url.split("/")[-1], r.status_code)
                continue
            data = r.json()
            if isinstance(data, list) and data:
                pid = data[0].get("id")
                if pid:
                    log.debug("[%s] Processo %s → ID %s", tribunal, numero_cnj, pid)
                    return pid
            elif isinstance(data, dict):
                pid = data.get("id")
                if pid:
                    log.debug("[%s] Processo %s → ID %s", tribunal, numero_cnj, pid)
                    return pid
        except Exception as e:
            log.debug("[%s] Erro em %s: %s", tribunal, url[:50], e)

    log.warning("[%s] Processo %s nao encontrado na API", tribunal, numero_cnj)
    return None


def _normalizar_data(data_raw: str) -> str:
    """Normaliza data para DD/MM/YYYY."""
    if not data_raw:
        return ""
    # Remover parte de hora (2022-08-02T11:45:00)
    if "T" in data_raw:
        data_raw = data_raw.split("T")[0]
    # YYYY-MM-DD → DD/MM/YYYY
    if re.match(r"\d{4}-\d{2}-\d{2}", data_raw):
        partes = data_raw.split("-")
        return f"{partes[2]}/{partes[1]}/{partes[0]}"
    return data_raw


def _buscar_movimentacoes_api(session, proc_id: int, tribunal: str, grau: str = "1") -> list[dict]:
    """
    Busca movimentacoes via API REST. Tenta multiplos endpoints:
      1. /processos/{id}/movimentacoes — lista de movimentacoes
      2. /processos/{id}/timeline — timeline com documentos
    Retorna as 2 mais recentes.
    """
    consulta_api = _cfg(tribunal, grau, "consulta_api")

    endpoints = [
        (f"{consulta_api}/processos/{proc_id}/movimentacoes", "movimentacoes"),
        (f"{consulta_api}/processos/{proc_id}/timeline"
         f"?somenteDocumentosAssinados=false&buscarMovimentos=true&buscarDocumentos=false",
         "timeline"),
    ]

    for url, tipo_ep in endpoints:
        try:
            r = session.get(url, timeout=30)
            if not r.ok:
                log.debug("[%s] %s retornou %d para proc %s", tribunal, tipo_ep, r.status_code, proc_id)
                continue

            dados = r.json()
            # A resposta pode ser lista direta ou objeto com "resultado"/"items"
            items = dados
            if isinstance(dados, dict):
                items = dados.get("resultado", dados.get("items", dados.get("movimentacoes", [])))
            if not isinstance(items, list):
                continue

            if not items:
                log.debug("[%s] %s vazio para proc %s", tribunal, tipo_ep, proc_id)
                continue

            movs = []
            for item in items[:2]:
                # A API PJe Consulta Processual retorna a data em varios nomes:
                # dataMovimento, dataHora, dataHoraJuntada, dataExpedicao, data
                data_mov = (
                    item.get("dataMovimento") or item.get("dataHora")
                    or item.get("dataHoraJuntada") or item.get("dataExpedicao")
                    or item.get("dataProgresso") or item.get("data") or ""
                )
                descricao = (
                    item.get("descricao") or item.get("movimento")
                    or item.get("titulo") or item.get("nome") or ""
                )
                tipo_mov = item.get("tipo") or item.get("tipoMovimento") or ""

                if not descricao:
                    continue

                movs.append({
                    "data": _normalizar_data(data_mov),
                    "titulo": descricao[:100],
                    "descricao": descricao,
                    "tipo": tipo_mov,
                })

            if movs:
                log.info("[%s] API %s → %d movimentacoes (proc %s)", tribunal, tipo_ep, len(movs), proc_id)
                return movs

        except Exception as e:
            log.debug("[%s] Erro em %s: %s", tribunal, tipo_ep, e)

    return []


# ============================================================
#  Fallback — Extracao via navegador (detalhe-processo)
# ============================================================
def _coletar_movs_trf3_legado(driver, numero_cnj: str, grau: str = "1") -> list[dict]:
    """
    TRF3 roda PJe Legado (JBoss Seam) — nao tem detalhe-processo moderno nem
    a mesma API REST dos TRTs. O fluxo de consulta eh:
      1. Abrir listView.seam
      2. Preencher campo "Numero do Processo" (input dentro de fPP:numeroProcesso)
      3. Clicar "Pesquisar" (fPP:searchProcessos)
      4. Clicar no link do processo encontrado
      5. Ler as movimentacoes da aba "Movimentacoes" do processo
    """
    consulta_url = _cfg("TRF3", grau, "consulta_url")
    log.info("[TRF3/%sg] listView: %s", grau, consulta_url[:80])

    try:
        driver.get(consulta_url)
        # Aguarda DOM pronto (sai ~200ms se já tá carregado)
        _wait_dom_ready(driver, timeout=8)
        # Aguarda o form de pesquisa aparecer (campo de numero do processo)
        _wait_element_visible(driver, [
            'input[id*="numeroProcesso" i]',
            'input[name*="numeroProcesso" i]',
            'input[id*="nrProcesso" i]',
        ], timeout=6)

        current = driver.current_url
        if not _is_authenticated(current):
            log.warning("[TRF3/%sg] Redirecionado ao login no listView", grau)
            return []

        # Preencher numero do processo e submeter. PJe legado do TRF3 usa campo
        # mascarado em 6 slots (NNNNNNN-DD.YYYY.J.TR.OOOO = 7/2/4/1/2/4 digitos).
        # Precisa distribuir os digitos pelos inputs na ordem certa.
        submetido = driver.execute_script("""
            var alvo = arguments[0];
            var soDigitos = alvo.replace(/[^0-9]/g, '');
            if (soDigitos.length < 20) {
                // CNJ incompleto — nao da pra alinhar slots; tenta com o que tem
                soDigitos = soDigitos.padStart(20, '0');
            }

            // Busca inputs visiveis que pareceam campo de numero de processo
            var raw = document.querySelectorAll(
                'input[id*="numeroProcesso" i], input[name*="numeroProcesso" i], ' +
                'input[id*="NumeroProcesso"], input[id*="nrProcesso" i]'
            );
            var inputs = [];
            for (var i = 0; i < raw.length; i++) {
                if (raw[i].offsetParent !== null && raw[i].type !== 'hidden') {
                    inputs.push(raw[i]);
                }
            }
            if (inputs.length === 0) return 'sem_input';

            function dispatchFill(el, val) {
                el.focus();
                el.value = '';
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.value = val;
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
            }

            if (inputs.length === 1) {
                // Form com campo unico: tenta so digitos primeiro, cai pra formatado
                dispatchFill(inputs[0], soDigitos);
                if ((inputs[0].value || '').replace(/[^0-9]/g, '').length < 20) {
                    dispatchFill(inputs[0], alvo);
                }
                inputs[0].dispatchEvent(new Event('blur', {bubbles: true}));
            } else {
                // Form com multiplos slots — mascara CNJ 7-2-4-1-2-4
                var segs = [7, 2, 4, 1, 2, 4];
                var pos = 0;
                for (var i = 0; i < inputs.length; i++) {
                    var inp = inputs[i];
                    var ml = parseInt(inp.getAttribute('maxlength') || '0', 10);
                    var tamanho = (ml > 0 && ml <= 7) ? ml : (segs[i] || 4);
                    var val = soDigitos.substr(pos, tamanho);
                    pos += tamanho;
                    dispatchFill(inp, val);
                }
                // Blur apenas no ultimo input, evita postback Seam parcial no meio
                inputs[inputs.length - 1].dispatchEvent(new Event('blur', {bubbles: true}));
            }

            // Encontrar botao Pesquisar
            var btns = document.querySelectorAll(
                'input[type="submit"], input[type="button"], button'
            );
            for (var j = 0; j < btns.length; j++) {
                var b = btns[j];
                var txt = (b.value || b.textContent || '').trim().toLowerCase();
                if (txt === 'pesquisar' || txt === 'consultar' || txt === 'buscar') {
                    if (b.offsetParent !== null) {
                        b.click();
                        return 'ok';
                    }
                }
            }
            // Fallback: submeter form pai do primeiro input
            var form = inputs[0].closest('form');
            if (form) { form.submit(); return 'form_submit'; }
            return 'sem_botao';
        """, numero_cnj)

        if submetido == "sem_input":
            log.warning("[TRF3/%sg] Campo de numero nao encontrado em %s", grau, numero_cnj)
            return []
        log.debug("[TRF3/%sg] Pesquisa submetida (%s)", grau, submetido)

        # Aguardar resultados do postback Seam aparecerem. PJe legado faz
        # postback completo da página, então a tabela de resultados só
        # aparece após o round-trip com o servidor. Poll até aparecer a
        # tabela OU um link clicável contendo o CNJ.
        _wait_dom_ready(driver, timeout=10)
        _wait_element_visible(driver, [
            'table a[href*="j_id"]',  # links de linha do rich:dataTable
            'table tbody tr a',
            'input[id*="captcha" i]',
            'img[src*="captcha" i]',
        ], timeout=10)

        # Captcha: polling ativo (sai assim que resolver)
        _wait_captcha_resolved(driver, timeout=TIMEOUT_CAPTCHA)

        # Clicar no link do resultado (tabela de resultados)
        clicou = driver.execute_script("""
            var alvo = arguments[0].replace(/[^0-9]/g, '');
            // Links de detalhe tipicamente tem id "j_idXX:XX:processoTrfViewView" ou
            // contem o numero do processo no texto
            var links = document.querySelectorAll('a');
            for (var i = 0; i < links.length; i++) {
                var txt = (links[i].textContent || '').replace(/[^0-9]/g, '');
                if (txt && txt.indexOf(alvo) !== -1) {
                    links[i].click();
                    return true;
                }
            }
            return false;
        """, numero_cnj)

        if not clicou:
            log.info("[TRF3/%sg] Nenhum resultado clicavel para %s", grau, numero_cnj)
            return []

        # Aguarda a navegação para a página do processo terminar. Click no
        # PJe legado gera um postback Seam, então o DOM readyState volta
        # pra 'loading' antes de voltar a 'complete'. Poll até estar pronto
        # E até aparecer conteúdo típico da página de detalhe.
        _wait_dom_ready(driver, timeout=10)
        _wait_element_visible(driver, [
            'table',             # qualquer tabela (movimentações, partes, etc.)
            'a[id*="movimenta" i]',  # aba de movimentações
            'div[id*="movimenta" i]',
        ], timeout=8)

        # Abrir aba/secao de movimentacoes caso exista um tab
        clicou_tab = driver.execute_script("""
            var tabs = document.querySelectorAll('a, span, div');
            for (var i = 0; i < tabs.length; i++) {
                var txt = (tabs[i].textContent || '').trim().toLowerCase();
                if (txt === 'movimentações' || txt === 'movimentacoes' ||
                    txt === 'movimentos' || txt === 'andamentos') {
                    if (tabs[i].offsetParent !== null && tabs[i].click) {
                        try { tabs[i].click(); } catch (e) {}
                        return true;
                    }
                }
            }
            return false;
        """)
        if clicou_tab:
            # Espera a tabela de movimentações aparecer (postback Seam ou render local)
            _wait_dom_ready(driver, timeout=6)
            _wait_element_visible(driver, [
                'table tr td',
            ], timeout=4)

        # Extrair movimentacoes. No PJe legado elas aparecem em tabelas com
        # colunas "Data" e "Descricao" — pegamos as 2 primeiras linhas.
        movs_raw = driver.execute_script("""
            var result = [];
            var tabelas = document.querySelectorAll('table');
            for (var t = 0; t < tabelas.length; t++) {
                var tb = tabelas[t];
                var tbTxt = tb.textContent.toLowerCase();
                if (tbTxt.indexOf('moviment') === -1) continue;
                var rows = tb.querySelectorAll('tbody tr');
                if (rows.length === 0) rows = tb.querySelectorAll('tr');
                for (var r = 0; r < rows.length && result.length < 2; r++) {
                    var tds = rows[r].querySelectorAll('td');
                    if (tds.length < 2) continue;
                    var t0 = tds[0].textContent.trim();
                    var t1 = tds[tds.length - 1].textContent.trim();
                    // coluna 0 deve parecer data
                    if (!/\\d{2}\\/\\d{2}\\/\\d{2,4}/.test(t0)) continue;
                    if (!t1 || t1.length < 3) continue;
                    result.push({data: t0, descricao: t1.substring(0, 400)});
                }
                if (result.length > 0) break;
            }
            return result;
        """)

        parsed = []
        for m in (movs_raw or [])[:2]:
            desc = (m.get("descricao") or "").strip()
            if desc:
                parsed.append({
                    "data": _normalizar_data(m.get("data", "")),
                    "titulo": desc[:100],
                    "descricao": desc,
                    "tipo": "browser_trf3_legado",
                })

        if parsed:
            log.info("[TRF3/%sg] Extraidas %d movs de %s", grau, len(parsed), numero_cnj)
        else:
            log.info("[TRF3/%sg] Sem movimentacoes extraidas para %s", grau, numero_cnj)
        return parsed

    except Exception as e:
        log.warning("[TRF3/%sg] Erro extraindo %s: %s", grau, numero_cnj, e)
        return []


def _coletar_movs_browser(driver, tribunal: str, numero_cnj: str, grau: str = "1") -> list[dict]:
    """
    Fallback: navega a pagina de detalhe do processo e extrai movimentacoes via DOM.

    Roteiro PJe moderno (TRT2/TRT15):
      URL: consultaprocessual/detalhe-processo/{NUMERO}/{instancia}  (1 ou 2)
      - Lado esquerdo: lista de movimentacoes com datas
      - Se captcha aparecer, aguarda 30s para resolucao humana

    Para TRF3 (PJe legado JBoss Seam), delega para _coletar_movs_trf3_legado.
    """
    if tribunal == "TRF3":
        return _coletar_movs_trf3_legado(driver, numero_cnj, grau=grau)

    config = PJE_CONFIG[tribunal]
    detalhe_url = config.get("detalhe_url")
    if not detalhe_url:
        log.debug("[%s] Sem URL detalhe para tribunal (browser fallback indisponivel)", tribunal)
        return []

    instancia = "2" if grau == "2" else "1"
    url = detalhe_url.format(numero=numero_cnj, instancia=instancia)
    log.info("[%s] Browser fallback: %s", tribunal, url[:80])

    try:
        driver.get(url)
        # Aguarda DOM pronto em polling (sai antes dos 8s se a página carregar rápido)
        _wait_dom_ready(driver, timeout=8)
        # Aguarda aparecer o conteúdo da timeline OU indicador de captcha/login.
        # Se nada aparecer em 5s, segue com o que tem — evita travar aqui.
        _wait_element_visible(driver, [
            '.timeline-item',
            '[class*="movimentacao"]',
            '.list-group-item',
            '.g-recaptcha',
            'input[id*="captcha" i]',
            'a[href*="login"]',
        ], timeout=5)

        # Verificar captcha: agora usa polling ativo (sai assim que o operador resolver)
        _wait_captcha_resolved(driver, timeout=TIMEOUT_CAPTCHA)

        # Verificar redirecionamento para login
        current = driver.current_url
        if not _is_authenticated(current):
            log.warning("[%s] Redirecionado ao login no browser fallback", tribunal)
            return []

        # Extrair movimentacoes via JavaScript
        movs_raw = driver.execute_script("""
            var result = [];

            // === Estrategia 1: seletores do PJe moderno (Angular) ===
            var selectors = [
                '.timeline-item',
                '.movimentacao-item',
                '.item-timeline',
                'pje-timeline-item',
                '[class*="movimentacao"]',
                '.list-group-item',
                '.card-body .list-group .list-group-item',
                'mat-list-item',
            ];

            var items = [];
            for (var i = 0; i < selectors.length; i++) {
                var found = document.querySelectorAll(selectors[i]);
                if (found.length > 0) {
                    items = found;
                    break;
                }
            }

            if (items.length > 0) {
                for (var j = 0; j < Math.min(items.length, 5); j++) {
                    var item = items[j];
                    var text = item.textContent.trim();

                    // Extrair data (formatos: DD/MM/YYYY, DD mmm. YYYY, DD de mmm de YYYY)
                    var dataMatch = text.match(/(\\d{1,2}\\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z.]*\\s*\\d{4})/i);
                    if (!dataMatch) dataMatch = text.match(/(\\d{2}\\/\\d{2}\\/\\d{4})/);
                    if (!dataMatch) dataMatch = text.match(/(\\d{2}\\.\\d{2}\\.\\d{4})/);

                    var data = dataMatch ? dataMatch[1].trim() : '';
                    var desc = text.replace(data, '').replace(/\\s+/g, ' ').trim();

                    if (desc && desc.length > 5) {
                        result.push({data: data, descricao: desc.substring(0, 300)});
                    }
                }
            }

            // === Estrategia 2: painel lateral (sidebar com movimentacoes) ===
            if (result.length === 0) {
                var sidebar = document.querySelector(
                    '.sidebar, .panel-lateral, [class*="sidebar"], [class*="lateral"]'
                );
                if (!sidebar) {
                    // Tentar o primeiro painel da esquerda
                    var panels = document.querySelectorAll('.col-md-4, .col-sm-4, .col-3, .col-4');
                    if (panels.length > 0) sidebar = panels[0];
                }

                if (sidebar) {
                    var children = sidebar.querySelectorAll('div, li, a, span');
                    var currentData = '';
                    for (var k = 0; k < children.length && result.length < 5; k++) {
                        var child = children[k];
                        var txt = child.textContent.trim();
                        if (!txt || txt.length < 3) continue;

                        // Verificar se eh data
                        var dm = txt.match(/^(\\d{1,2}[\\s\\/.-](?:\\w{3,}|\\d{2})[\\s\\/.-]\\d{2,4})$/);
                        if (dm) {
                            currentData = dm[1];
                            continue;
                        }

                        // Verificar se eh descricao de movimentacao
                        if (txt.length > 10 && !txt.match(/^(Consulta|Tribunal|Manuais|Fale)/i)) {
                            result.push({
                                data: currentData,
                                descricao: txt.substring(0, 300)
                            });
                            currentData = '';
                        }
                    }
                }
            }

            // === Estrategia 3: texto geral da pagina ===
            if (result.length === 0) {
                var body = document.body.textContent || '';
                // Procurar padroes de movimentacao
                var movPattern = /(?:Intima[cç][aã]o|Despacho|Senten[cç]a|Ac[oó]rd[aã]o|Arquiv|Juntada|Certid[aã]o|Expedid)/gi;
                var matches = body.match(new RegExp('.{0,30}' + movPattern.source + '.{0,100}', 'gi'));
                if (matches) {
                    for (var m = 0; m < Math.min(matches.length, 3); m++) {
                        result.push({data: '', descricao: matches[m].trim()});
                    }
                }
            }

            return result;
        """)

        if movs_raw:
            parsed = []
            for m in movs_raw[:2]:
                desc = m.get("descricao", "").strip()
                if desc:
                    parsed.append({
                        "data": m.get("data", ""),
                        "titulo": desc[:100],
                        "descricao": desc,
                        "tipo": "browser_extract",
                    })
            if parsed:
                log.info("[%s] Browser extraiu %d movimentacoes de %s", tribunal, len(parsed), numero_cnj)
            return parsed

    except Exception as e:
        log.warning("[%s] Erro na extracao browser de %s: %s", tribunal, numero_cnj, e)

    return []


# ============================================================
#  Persistencia
# ============================================================
def _salvar_movimentacoes(db_conn, processo_id: int, numero_cnj: str, movs: list[dict]) -> list[dict]:
    """
    Salva movimentacoes novas. Retorna lista das NOVAS.

    Dedup em 2 camadas (igual ao e-SAJ):
      1. hash_dedup normalizado
      2. Fallback por (data normalizada + texto normalizado) contra o que ja
         esta no banco do mesmo processo — resiliente a hashes legados.
    """
    novas = []
    now = datetime.now().isoformat()

    existentes = db_conn.execute(
        """SELECT id, data_movimento, descricao, hash_dedup
           FROM granola_movimentacoes WHERE processo_id = ?""",
        (processo_id,)
    ).fetchall()
    assinaturas_existentes = {
        (_normalize_date(e["data_movimento"]), _normalize_text(e["descricao"]))
        for e in existentes
    }
    hashes_existentes = {e["hash_dedup"] for e in existentes if e["hash_dedup"]}

    for mov in movs:
        h = _hash_mov(numero_cnj, mov["data"], mov["descricao"])

        if h in hashes_existentes:
            continue

        assinatura = (_normalize_date(mov["data"]), _normalize_text(mov["descricao"]))
        if assinatura in assinaturas_existentes:
            log.debug("Mov PJe %s ja existe (match por conteudo normalizado)", numero_cnj)
            continue

        try:
            db_conn.execute(
                """INSERT INTO granola_movimentacoes
                   (processo_id, tipo, descricao, data_movimento, fonte, hash_dedup, criado_em)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (processo_id, mov["titulo"][:100], mov["descricao"], mov["data"], "pje_auto", h, now)
            )
            novas.append(mov)
            hashes_existentes.add(h)
            assinaturas_existentes.add(assinatura)
        except Exception as e:
            log.warning("Erro salvando mov PJe %s: %s", numero_cnj, e)

    if novas:
        db_conn.commit()
    return novas


# ============================================================
#  Coleta principal
# ============================================================
def coletar_publicacoes_pje(callback=None, processo_ids=None) -> dict:
    """
    Coleta movimentacoes PJe de todos os tribunais.

    Estrategia (baseada no roteiro PJe):
      1. Agrupar processos por tribunal
      2. Para cada tribunal na ordem (TRT2 → TRT15 → TRF3):
         a. Login PDPJ (operador faz auth manual; SSO compartilhado)
         b. Navegar a consulta processual
         c. Extrair sessao (cookies)
         d. Para cada processo:
            - API REST (rapido, sem captcha)
            - Fallback: browser detalhe-processo (com captcha se necessario)
      3. Salvar novas movimentacoes
    """
    global _running_pje
    if _running_pje:
        return {"error": "Coleta PJe ja em andamento"}

    _running_pje = True
    _pause_event_pje.clear()
    _atualizar_progresso(em_andamento=True, index=0, total=0, novas=0, erros=0,
                         tribunal_atual=None, processo_atual=None,
                         processo_atual_titulo=None, status="Iniciando...", etapa="inicio")
    modo = "reteste" if processo_ids else "completa"
    append_log("pje", "info", f"Coleta PJe iniciada ({modo})")
    driver = None
    resultado = {
        "total": 0,
        "consultados": 0,
        "com_novidade": 0,
        "requer_login": [],
        "novas_movimentacoes": [],
        "erros": [],
        "inicio": datetime.now().isoformat(),
        "fim": None,
    }

    try:
        # 1. Buscar processos PJe do banco
        conn = get_connection()
        if processo_ids:
            placeholders = ",".join("?" for _ in processo_ids)
            processos = conn.execute(
                f"""SELECT id, numero_cnj, titulo, status, fase FROM granola_processos
                   WHERE id IN ({placeholders})
                   ORDER BY numero_cnj""",
                processo_ids
            ).fetchall()
        else:
            processos = conn.execute(
                """SELECT id, numero_cnj, titulo, status, fase FROM granola_processos
                   WHERE numero_cnj IS NOT NULL
                   AND (numero_cnj LIKE '%%.5.02.%%'
                        OR numero_cnj LIKE '%%.5.15.%%'
                        OR numero_cnj LIKE '%%.4.03.%%')
                   ORDER BY numero_cnj"""
            ).fetchall()

        resultado["total"] = len(processos)
        if not processos:
            log.info("Nenhum processo PJe cadastrado no Granola")
            append_log("pje", "info", "Nenhum processo PJe na fila")
            return resultado

        log.info("Coleta PJe: %d processos encontrados", len(processos))
        append_log("pje", "info", f"PJe: {len(processos)} processo(s) na fila")
        if callback:
            callback("inicio", {"total": len(processos)})

        # 2. Agrupar por (tribunal, grau). Cada chave tem login proprio.
        por_tribunal_grau = {}
        for proc in processos:
            trt = _tribunal_from_cnj(proc["numero_cnj"])
            if not trt:
                continue
            try:
                fase = proc["fase"]
            except (KeyError, IndexError):
                fase = None
            grau = _detectar_grau_pje(fase)
            por_tribunal_grau.setdefault((trt, grau), []).append(proc)

        # 3. Garantir Chromium rodando
        if not _ensure_chromium():
            for proc in processos:
                resultado["erros"].append(f"{proc['numero_cnj']}: Chromium indisponivel")
            append_log("pje", "error", "Chromium indisponível")
            return resultado

        # 4. Obter driver (unico para toda a coleta — SSO compartilhado)
        driver, err_conn = _get_driver()
        if not driver:
            detalhe = f": {err_conn}" if err_conn else ""
            for proc in processos:
                resultado["erros"].append(f"{proc['numero_cnj']}: Falha ao conectar ao Chromium{detalhe}")
            append_log("pje", "error", f"Falha ao conectar ao Chromium{detalhe}")
            return resultado

        # 5. Para cada tribunal na ordem TRT2 → TRT15 → TRF3, e dentro dele 1º grau antes de 2º grau
        pdpj_logado = False
        for tribunal in ORDEM_TRIBUNAIS:
            for grau in ("1", "2"):
                procs = por_tribunal_grau.get((tribunal, grau))
                if not procs:
                    continue

                log.info("=" * 60)
                log.info("[%s/%sg] Iniciando coleta de %d processos", tribunal, grau, len(procs))
                append_log("pje", "info",
                           f"[{tribunal}/{grau}g] Iniciando — {len(procs)} processo(s)")
                _atualizar_progresso(tribunal_atual=f"{tribunal}/{grau}g", etapa="login",
                                    status=f"Aguardando login {tribunal} ({grau}º grau)...")

                # Login PDPJ — SSO do tribunal anterior pode redirecionar automaticamente
                if pdpj_logado:
                    log.info("[%s/%sg] SSO PDPJ — tentando login automatico", tribunal, grau)
                    append_log("pje", "info",
                               f"[{tribunal}/{grau}g] Tentando SSO automático do PDPJ")
                else:
                    append_log("pje", "info",
                               f"[{tribunal}/{grau}g] Aguardando login PDPJ do operador")

                logado = _login_tribunal(driver, tribunal, grau=grau)
                if not logado:
                    # Nao conseguiu logar — marcar processos como requer_login
                    append_log("pje", "warn",
                               f"[{tribunal}/{grau}g] Login PDPJ não concluído — {len(procs)} processo(s) ficarão pendentes")
                    for proc in procs:
                        resultado["consultados"] += 1
                        resultado["requer_login"].append({
                            "processo": proc["numero_cnj"],
                            "processo_id": proc["id"],
                            "titulo_processo": proc["titulo"],
                            "tribunal": f"{tribunal}/{grau}g",
                        })
                        if callback:
                            callback("processo", {
                                "numero": proc["numero_cnj"],
                                "index": resultado["consultados"],
                                "total": resultado["total"],
                                "status": f"requer login PDPJ ({tribunal}/{grau}g)",
                                "novas": 0,
                            })
                    continue

                append_log("pje", "success", f"[{tribunal}/{grau}g] Login PDPJ confirmado")

                pdpj_logado = True

                # Criar sessao requests a partir dos cookies do browser
                session = _create_session_from_driver(driver, tribunal, grau=grau)
                api_disponivel = session is not None

                if not api_disponivel:
                    log.warning("[%s/%sg] Sessao API indisponivel — usando apenas browser", tribunal, grau)

                _atualizar_progresso(etapa="coletando",
                                     status=f"Coletando {tribunal} ({grau}º grau)...")

                # Consultar cada processo
                for proc in procs:
                    # Respeita pausa do operador entre processos
                    _wait_if_paused_pje()

                    numero_cnj = proc["numero_cnj"]
                    processo_id = proc["id"]
                    resultado["consultados"] += 1
                    _atualizar_progresso(
                        processo_atual=numero_cnj,
                        processo_atual_titulo=proc["titulo"],
                        index=resultado["consultados"],
                        total=resultado["total"],
                        status=f"[{tribunal}/{grau}g] {numero_cnj}",
                    )
                    append_log("pje", "info",
                               f"[{resultado['consultados']}/{resultado['total']}] "
                               f"[{tribunal}/{grau}g] Consultando {numero_cnj}"
                               + (f" — {proc['titulo']}" if proc['titulo'] else ""),
                               processo=numero_cnj)

                    try:
                        movs = []
                        via = None  # "api" | "browser"

                        # === Estrategia 1: API REST (rapido, sem captcha) ===
                        # TRF3 eh PJe legado (JBoss Seam) — nao tem essa API no mesmo formato.
                        # Pular direto para browser no TRF3.
                        if api_disponivel and tribunal != "TRF3":
                            proc_id = _buscar_processo_id(session, numero_cnj, tribunal, grau=grau)
                            if proc_id:
                                movs = _buscar_movimentacoes_api(session, proc_id, tribunal, grau=grau)
                                if movs:
                                    via = "api"

                        # === Estrategia 2: Browser fallback (detalhe-processo ou listView TRF3) ===
                        if not movs:
                            if tribunal != "TRF3":
                                log.info("[%s/%sg] API sem resultado para %s — tentando browser",
                                         tribunal, grau, numero_cnj)
                                append_log("pje", "info",
                                           f"  → API sem resultado, fallback para browser",
                                           processo=numero_cnj)
                            movs = _coletar_movs_browser(driver, tribunal, numero_cnj, grau=grau)
                            if movs:
                                via = "browser"

                        # Salvar novas movimentacoes
                        novas = []
                        if movs:
                            novas = _salvar_movimentacoes(conn, processo_id, numero_cnj, movs)
                            if novas:
                                resultado["com_novidade"] += 1
                                _atualizar_progresso(novas=_progresso_pje["novas"] + len(novas))
                                for n in novas:
                                    resultado["novas_movimentacoes"].append({
                                        "processo": numero_cnj,
                                        "processo_id": processo_id,
                                        "titulo_processo": proc["titulo"],
                                        "data": n["data"],
                                        "titulo": n["titulo"],
                                        "descricao": n["descricao"],
                                    })

                        # Callback de progresso + log
                        status_msg = f"ok ({len(movs)} movs)" if movs else "sem movimentacoes"
                        if movs:
                            nivel = "success" if novas else "info"
                            append_log("pje", nivel,
                                       f"  → {len(movs)} mov(s) via {via}, {len(novas)} nova(s)",
                                       processo=numero_cnj)
                        else:
                            append_log("pje", "info",
                                       f"  → sem movimentações",
                                       processo=numero_cnj)
                        if callback:
                            callback("processo", {
                                "numero": numero_cnj,
                                "index": resultado["consultados"],
                                "total": resultado["total"],
                                "status": status_msg,
                                "novas": len(novas),
                            })

                    except Exception as e:
                        resultado["erros"].append(f"{numero_cnj}: {e}")
                        log.error("[%s/%sg] Erro em %s: %s", tribunal, grau, numero_cnj, e)
                        _atualizar_progresso(erros=_progresso_pje["erros"] + 1)
                        append_log("pje", "error", f"  → ERRO: {e}", processo=numero_cnj)
                        if callback:
                            callback("erro", {"numero": numero_cnj, "erro": str(e)})

                    time.sleep(SLEEP_ENTRE_PROCESSOS)

                log.info("[%s/%sg] Coleta finalizada", tribunal, grau)
                append_log("pje", "info", f"[{tribunal}/{grau}g] Bloco finalizado")

        conn.close()

        # Reportar processos que requerem login
        if resultado["requer_login"]:
            tribunais = set(p.get("tribunal", "PJe") for p in resultado["requer_login"])
            msg = (
                f"{len(resultado['requer_login'])} processo(s) PJe necessitam login PDPJ "
                f"({', '.join(tribunais)}). Abra o Chromium PJe e faca login com certificado digital."
            )
            log.info(msg)
            if callback:
                callback("requer_login", {
                    "processos": resultado["requer_login"],
                    "mensagem": msg,
                })

    except Exception as e:
        resultado["erros"].append(f"Erro geral PJe: {e}")
        log.error("Erro geral coleta PJe: %s", e)
        append_log("pje", "error", f"Erro geral na coleta: {e}")

    finally:
        _running_pje = False
        _pause_event_pje.clear()  # sempre limpa pause ao terminar
        _atualizar_progresso(em_andamento=False, etapa="finalizado",
                             status="Coleta PJe concluida",
                             processo_atual=None, processo_atual_titulo=None)
        append_log(
            "pje",
            "success" if not resultado["erros"] else "warn",
            f"Coleta PJe finalizada: {resultado['consultados']}/{resultado['total']} "
            f"consultados, {len(resultado['novas_movimentacoes'])} nova(s), "
            f"{len(resultado['erros'])} erro(s)"
        )
        resultado["fim"] = datetime.now().isoformat()
        # Fechar aba _pje_coleta — EXCETO quando processos PJe precisam de
        # login PDPJ manual (operador vai querer ver a tela para logar).
        # NUNCA usar driver.quit() (mata Sardela).
        if driver:
            tem_requer_login = bool(resultado["requer_login"])
            if tem_requer_login:
                append_log(
                    "pje",
                    "warn",
                    f"{len(resultado['requer_login'])} processo(s) PJe precisam de login PDPJ — "
                    "a aba do PJe foi mantida aberta. Faça o login no Chromium "
                    "e retente depois."
                )
                log.info(
                    "Mantendo aba _pje_coleta aberta (%d processos requer_login)",
                    len(resultado["requer_login"])
                )
            else:
                try:
                    driver.close()
                except Exception:
                    pass
        try:
            conn.close()
        except Exception:
            pass

    log.info(
        "Coleta PJe concluida: %d consultados, %d com novidade, %d novas movs, %d erros",
        resultado["consultados"], resultado["com_novidade"],
        len(resultado["novas_movimentacoes"]), len(resultado["erros"]),
    )

    if callback:
        callback("fim", resultado)

    return resultado


# ============================================================
#  Execucao diaria
# ============================================================
def verificar_coleta_diaria_pje():
    """Verifica se ja rodou PJe hoje. Se nao, dispara em background."""
    global _last_run_date_pje
    hoje = date.today()

    if _last_run_date_pje == hoje:
        return False

    try:
        conn = get_connection()
        row = conn.execute(
            "SELECT value FROM granola_config WHERE key = 'ultima_coleta_pje'"
        ).fetchone()
        conn.close()
        if row and row["value"]:
            ultima = datetime.fromisoformat(row["value"]).date()
            if ultima == hoje:
                _last_run_date_pje = hoje
                return False
    except Exception:
        pass

    _last_run_date_pje = hoje
    log.info("Primeira inicializacao do dia — agendando coleta PJe")

    def _run():
        # Aguarda servidor subir e dar tempo do thread eSAJ marcar _running=True
        time.sleep(10)
        # SEMPRE rodar depois do e-SAJ: esaj → trt2 → trt15 → trf3.
        # Se e-SAJ ainda esta rodando, espera ate terminar (max 30 min).
        from granola import publicacoes as _esaj_mod
        espera_max = 30 * 60
        aguardou = 0
        while getattr(_esaj_mod, "_running", False) and aguardou < espera_max:
            if aguardou % 30 == 0:
                log.info("Aguardando coleta e-SAJ terminar antes de iniciar PJe (%ds)...", aguardou)
            time.sleep(5)
            aguardou += 5
        log.info("Iniciando coleta automatica PJe (TRT2 -> TRT15 -> TRF3)...")
        resultado = coletar_publicacoes_pje()

        try:
            conn = get_connection()
            now = datetime.now().isoformat()
            conn.execute(
                """INSERT OR REPLACE INTO granola_config (key, value, atualizado_em)
                   VALUES ('ultima_coleta_pje', ?, ?)""",
                (now, now)
            )
            conn.execute(
                """INSERT OR REPLACE INTO granola_config (key, value, atualizado_em)
                   VALUES ('ultima_coleta_pje_resumo', ?, ?)""",
                (json.dumps(resultado, ensure_ascii=False, default=str), now)
            )
            conn.commit()
            conn.close()
        except Exception as e:
            log.error("Erro salvando config coleta PJe: %s", e)

    t = threading.Thread(target=_run, daemon=True, name="coleta-pje")
    t.start()
    return True


def get_status_coleta_pje() -> dict:
    """Retorna status da ultima coleta PJe."""
    try:
        conn = get_connection()
        row = conn.execute(
            "SELECT value FROM granola_config WHERE key = 'ultima_coleta_pje_resumo'"
        ).fetchone()
        ts_row = conn.execute(
            "SELECT value FROM granola_config WHERE key = 'ultima_coleta_pje'"
        ).fetchone()
        conn.close()
        return {
            "ultima_coleta": ts_row["value"] if ts_row else None,
            "resumo": json.loads(row["value"]) if row else None,
            "em_andamento": _running_pje,
        }
    except Exception:
        return {"ultima_coleta": None, "resumo": None, "em_andamento": _running_pje}
