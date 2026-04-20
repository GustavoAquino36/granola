"""
Granola — Pesquisa de Publicações e-SAJ
Coleta as 2 últimas movimentações de cada processo e-SAJ cadastrado.
Roda automaticamente na primeira inicialização do dia.
"""
import hashlib
import json
import logging
import os
import re
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, date
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from granola.database import GranolaDB, get_connection

log = logging.getLogger("granola.publicacoes")

# ============================================================
#  Config
# ============================================================
CDP_PORT = 9222  # Compartilha Chromium com Sardela (certificado + Web Signer)
CHROMIUM_PATH = os.path.expandvars(r"%LOCALAPPDATA%\Chromium\Application\chrome.exe")
ESAJ_BASE_1G = "https://esaj.tjsp.jus.br/cpopg"   # Primeiro grau (comarca/foro)
ESAJ_BASE_2G = "https://esaj.tjsp.jus.br/cposg"   # Segundo grau (TJSP sede)
ESAJ_BASE = ESAJ_BASE_1G  # compat — usado só para open.do de login
PROCESSO_RE = re.compile(r"\(?(\d{7}-\d{2}\.\d{4})\.8\.26\.(\d{4})\)?")
SLEEP_ENTRE_PROCESSOS = 0.8  # padrão Sardela: 0.8s entre consultas
TIMEOUT_LOGIN_ESAJ = 180  # 3 min para operador logar com certificado (antes: 30s — muito curto)

# Controle de execução diária
_last_run_date: date | None = None
_running = False

# Progresso em tempo real (atualizado durante coleta)
_progresso_esaj = {
    "em_andamento": False,
    "processo_atual": None,
    "processo_atual_titulo": None,
    "index": 0,
    "total": 0,
    "novas": 0,
    "erros": 0,
    "status": "",
    "etapa": "",
}

# ============================================================
#  Log compartilhado (e-SAJ + PJe) — buffer circular em memória
# ============================================================
# Buffer de eventos da coleta. Usado pelo front-end para exibir um feed em tempo
# real. Reusado pelo módulo publicacoes_pje via import. maxlen=400 evita que a
# memória cresça indefinidamente — mantém aproximadamente os últimos 400 eventos
# (equivale a ~4 ciclos de coleta completa com 100 processos cada).
_COLETA_LOG: deque = deque(maxlen=400)
_COLETA_LOG_LOCK = threading.Lock()
_COLETA_LOG_SEQ = 0  # contador monotônico — usado pelo front-end para paginar ("since")


def append_log(source: str, level: str, msg: str, *, processo: str | None = None) -> None:
    """
    Adiciona uma entrada ao log da coleta.

    source: "esaj" | "pje"
    level:  "info" | "warn" | "error" | "success"
    msg:    texto do evento
    processo: número CNJ opcional (para permitir filtragem/destaque no front)
    """
    global _COLETA_LOG_SEQ
    with _COLETA_LOG_LOCK:
        _COLETA_LOG_SEQ += 1
        _COLETA_LOG.append({
            "seq": _COLETA_LOG_SEQ,
            "ts": datetime.now().isoformat(timespec="seconds"),
            "source": source,
            "level": level,
            "msg": msg,
            "processo": processo,
        })


def get_logs(since: int = 0) -> dict:
    """Retorna eventos com seq > since. Resposta contém cursor para a próxima chamada."""
    with _COLETA_LOG_LOCK:
        entries = [e for e in _COLETA_LOG if e["seq"] > since]
        latest = _COLETA_LOG_SEQ
    return {"entries": entries, "latest": latest}


def clear_logs() -> None:
    """Limpa o buffer de log (útil quando o operador quer começar uma nova sessão limpa)."""
    global _COLETA_LOG_SEQ
    with _COLETA_LOG_LOCK:
        _COLETA_LOG.clear()
        # NÃO zera _COLETA_LOG_SEQ — manter monotônico evita confusão no cliente
        # que guardou um "since" antigo


# ============================================================
#  Pause / Resume — threading.Event por módulo
# ============================================================
# Convenção: quando _pause_event.is_set() == True → coleta está PAUSADA.
# A thread de coleta chama _wait_if_paused_esaj() entre processos e, se pausada,
# bloqueia em Event.wait() até o operador clicar em "retomar".
_pause_event_esaj = threading.Event()  # set = pausado


def pause_esaj() -> None:
    _pause_event_esaj.set()
    append_log("esaj", "warn", "Coleta e-SAJ pausada pelo operador")
    _atualizar_progresso_esaj(status="Pausado pelo operador", etapa="pausado")


def resume_esaj() -> None:
    _pause_event_esaj.clear()
    append_log("esaj", "info", "Coleta e-SAJ retomada")
    _atualizar_progresso_esaj(status="Retomando...", etapa="coletando")


def is_paused_esaj() -> bool:
    return _pause_event_esaj.is_set()


def _wait_if_paused_esaj() -> None:
    """
    Bloqueia enquanto a coleta estiver pausada. Chamado entre processos dentro
    do loop de coleta. Usa polling curto (0.5s) para permitir ajuste de status
    em tempo real e não consumir CPU.
    """
    while _pause_event_esaj.is_set():
        time.sleep(0.5)


def get_progresso_esaj() -> dict:
    """Retorna progresso em tempo real da coleta e-SAJ."""
    return dict(_progresso_esaj)


def _atualizar_progresso_esaj(**kwargs):
    """Atualiza progresso em tempo real."""
    _progresso_esaj.update(kwargs)


def _normalize_text(s: str) -> str:
    """
    Normaliza texto para deduplicação.
    - Colapsa qualquer whitespace (espaços, tabs, \\n) em um único espaço
    - Remove acentos visuais que variam entre coletas (NBSP → espaço)
    - Strip + lowercase
    - Trunca em 300 chars (maior que os 200 antigos — mais assinatura, menos colisão)

    Por que: a mesma publicação vem do e-SAJ às vezes com '\\n' entre campos,
    às vezes com espaços, ou com whitespace extra. Sem normalizar, cada coleta
    gerava um hash diferente e inseria duplicata.
    """
    if not s:
        return ""
    # NBSP → espaço normal
    s = s.replace("\xa0", " ")
    # Qualquer sequência de whitespace → 1 espaço
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()[:300]


def _normalize_date(d: str) -> str:
    """
    Normaliza data para formato ISO YYYY-MM-DD.
    Aceita DD/MM/YYYY (e-SAJ/PJe) e YYYY-MM-DD (importação).
    Se não casar nenhum formato, devolve a string limpa.
    """
    if not d:
        return ""
    d = d.strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", d)
    if m:
        return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", d)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
    return d


def _hash_mov(processo_num: str, data_mov: str, descricao: str) -> str:
    """
    Gera hash de deduplicação para uma movimentação.
    Normaliza data (ISO) e texto (whitespace + case) antes do hash para que
    a mesma publicação não gere hashes diferentes entre coletas.
    """
    data_norm = _normalize_date(data_mov)
    desc_norm = _normalize_text(descricao)
    raw = f"{processo_num}|{data_norm}|{desc_norm}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


# ============================================================
#  Chromium
# ============================================================
def _chromium_is_running() -> bool:
    """Verifica se Chromium já está rodando com CDP."""
    try:
        import urllib.request
        req = urllib.request.Request(f"http://127.0.0.1:{CDP_PORT}/json/version")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def _get_chromium_version_via_cdp() -> str | None:
    """Retorna a versão do Chromium rodando na porta CDP (ex: '146.0.7680.165')."""
    try:
        import urllib.request
        req = urllib.request.Request(f"http://127.0.0.1:{CDP_PORT}/json/version")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode())
        browser = data.get("Browser", "")  # ex: "Chrome/146.0.7680.165"
        if "/" in browser:
            return browser.split("/", 1)[1].strip()
    except Exception:
        pass
    return None


def _resolve_chromedriver_path() -> str | None:
    """
    Tenta localizar um chromedriver compatível com a versão do Chromium que está rodando.

    Contexto: Selenium Manager baixa o chromedriver mais recente no cache e usa esse.
    Quando o Chromium local fica para trás (ex: v146) e o Selenium baixou o v147,
    `webdriver.Chrome(options)` falha com "session not created: This version of
    ChromeDriver only supports Chrome version N".

    Estratégia:
      1. Pega a versão real do Chromium via CDP (/json/version)
      2. Procura no cache do Selenium Manager (~/.cache/selenium/chromedriver/<plat>/<ver>/)
         um chromedriver com a MESMA major version
      3. Se achar, retorna o path (a ser passado em Service(executable_path=...))
      4. Se não, retorna None — o caller cai no Selenium Manager normal (que vai
         tentar baixar a versão correta quando `browser_version` estiver setado)
    """
    chrome_ver = _get_chromium_version_via_cdp()
    if not chrome_ver:
        return None
    major = chrome_ver.split(".")[0]  # ex: "146"

    cache_root = Path.home() / ".cache" / "selenium" / "chromedriver"
    if not cache_root.exists():
        return None

    # Chromedriver por SO: win64, linux64, mac-arm64, mac-x64
    candidates: list[Path] = []
    for plat_dir in cache_root.iterdir():
        if not plat_dir.is_dir():
            continue
        for ver_dir in plat_dir.iterdir():
            if not ver_dir.is_dir():
                continue
            if ver_dir.name.split(".")[0] != major:
                continue
            for binary in ("chromedriver.exe", "chromedriver"):
                candidate = ver_dir / binary
                if candidate.exists():
                    candidates.append(candidate)
    if not candidates:
        return None
    # Prioriza match EXATO de versão (evita pegar um 146.0.7680.100 se tiver o .165)
    exact = [c for c in candidates if c.parent.name == chrome_ver]
    return str(exact[0] if exact else candidates[0])


def _launch_chromium():
    """Abre Chromium com remote debugging se não estiver rodando."""
    if _chromium_is_running():
        log.info("Chromium já está rodando na porta %d", CDP_PORT)
        return True

    if not Path(CHROMIUM_PATH).exists():
        log.error("Chromium não encontrado em %s", CHROMIUM_PATH)
        return False

    log.info("Abrindo Chromium e-SAJ (porta %d) — aguardando login do operador...", CDP_PORT)
    subprocess.Popen(
        [
            CHROMIUM_PATH,
            f"--remote-debugging-port={CDP_PORT}",
            "--no-first-run",
            "--disable-default-apps",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            f"{ESAJ_BASE}/open.do",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Aguarda Chromium iniciar
    for _ in range(15):
        time.sleep(1)
        if _chromium_is_running():
            log.info("Chromium pronto na porta %d", CDP_PORT)
            return True
    log.error("Chromium não respondeu no tempo esperado")
    return False


def _dismiss_alert_if_present(driver) -> bool:
    """
    Fecha alert/confirm/prompt JS pendente. Se não tratar, Selenium trava em
    UnexpectedAlertPresentException em operações subsequentes — e isso foi
    identificado como causa do "crash do Granola" em processos segredo de
    justiça (a página às vezes dispara alert de acesso negado).

    Retorna True se havia um alert e foi fechado.
    """
    try:
        alert = driver.switch_to.alert
        txt = alert.text
        log.warning("Alert JS detectado e fechado: %r", txt[:80])
        alert.dismiss()
        return True
    except Exception:
        return False


def _is_esaj_logged_in(driver) -> bool:
    """
    Verifica se QUALQUER aba do Chromium atual tem sessão e-SAJ logada.
    Cookies CAS são compartilhados entre abas do mesmo Chromium, então basta
    uma aba estar logada para todas herdarem a sessão.

    Detecção (qualquer um dos sinais):
      1. URL contém `ticket=` (redirect CAS recém-concluído)
      2. DOM tem <a href="...logout..."> visível ou oculto
      3. textContent do body contém "Sair" (inclui menus colapsados,
         diferente de innerText que ignora elementos hidden)

    A v1 usava `innerText.indexOf('Sair')` e dava falso negativo quando o link
    "Sair" ficava num menu colapsado (display:none) — típico do cabeçalho do
    e-SAJ quando logado, onde o nome do usuário aparece visível mas o menu
    dropdown com "Sair" fica oculto até hover.

    IMPORTANTE: essa função é READ-ONLY do ponto de vista do driver — sempre
    restaura a aba ativa ao final, mesmo quando retorna True.
    """
    _dismiss_alert_if_present(driver)
    original = None
    try:
        original = driver.current_window_handle
    except Exception:
        pass

    found = False
    try:
        for h in driver.window_handles:
            try:
                driver.switch_to.window(h)
                url = driver.current_url or ""
                if "esaj.tjsp.jus.br" not in url:
                    continue
                # Sinal 1: URL com ticket CAS
                if "ticket=" in url:
                    found = True
                    break
                # Sinal 2/3: logout link no DOM ou "Sair" no textContent
                is_logged = driver.execute_script("""
                    // Sinal mais forte: existência de link de logout
                    if (document.querySelector('a[href*="logout" i]')) return true;
                    if (document.querySelector('a[href*="Logout"]'))    return true;
                    // Fallback: textContent inclui "Sair" mesmo em elementos ocultos
                    // (diferente de innerText que só considera visível)
                    var body = document.body;
                    if (body && body.textContent) {
                        if (/\\bSair\\b/.test(body.textContent)) return true;
                    }
                    return false;
                """)
                if is_logged:
                    found = True
                    break
            except Exception:
                continue
    finally:
        # SEMPRE restaura a aba original — mesmo se encontrou login em outra aba,
        # o caller (_wait_for_login) espera o driver apontando de volta pra aba
        # de trabalho (_granola).
        if original:
            try:
                driver.switch_to.window(original)
            except Exception:
                pass
    return found


def _wait_for_login(driver, timeout=TIMEOUT_LOGIN_ESAJ) -> bool:
    """
    Garante que o e-SAJ está logado antes de seguir com as consultas.

    Pressuposto crítico: o driver deve estar na aba _granola no início dessa
    função E deve acabar na aba _granola no final — para não hijackar abas do
    Sardela e para que _extrair_movimentacoes navegue a aba correta.

    Fluxo:
      1. Salva a aba ativa (será a _granola do Sardela-Granola bridge).
      2. Verifica se alguma aba já está logada via _is_esaj_logged_in (agora
         read-only, restaura a aba original ao final).
      3. Se logado: retorna True imediatamente, aba ativa = _granola.
      4. Se NÃO logado: navega a PRÓPRIA aba _granola para open.do (assim o
         operador vê a tela de login, e a sessão CAS vira uma aba Granola-only
         — não interfere com Sardela).
      5. Aguarda polling até login aparecer ou timeout.
      6. No final, garante que a aba ativa é _granola (mesmo se o login falhou).
    """
    log.info("Verificando login e-SAJ...")
    _dismiss_alert_if_present(driver)

    # Captura a aba de trabalho — essa é a aba _granola que precisa permanecer
    # ativa ao final da função.
    try:
        granola_tab = driver.current_window_handle
    except Exception:
        log.warning("Driver sem aba ativa — abortando _wait_for_login")
        return False

    def _restore_granola_tab():
        """Sempre volta pra aba _granola no final, quer tenha dado certo ou não."""
        try:
            driver.switch_to.window(granola_tab)
            _dismiss_alert_if_present(driver)
        except Exception:
            pass

    # 1. Já logado? (essa função preserva a aba ativa — não precisa restaurar aqui)
    if _is_esaj_logged_in(driver):
        log.info("e-SAJ já logado — prosseguindo na aba _granola")
        _restore_granola_tab()
        return True

    # 2. Não logado — navega a PRÓPRIA aba _granola pra open.do. Assim a tela
    #    de login fica visível, e a sessão CAS fica atrelada à aba _granola
    #    (não hijack de aba Sardela).
    log.info("e-SAJ não logado — navegando _granola para open.do")
    try:
        driver.switch_to.window(granola_tab)
        driver.get(f"{ESAJ_BASE}/open.do")
    except Exception as e:
        log.warning("Falha ao navegar _granola para open.do: %s", e)
        _restore_granola_tab()
        return False

    # 3. Polling até login aparecer em QUALQUER aba ou timeout
    # Delega toda a detecção ao _is_esaj_logged_in (que agora é robusto a
    # "Sair" em menus colapsados e checa link de logout). Isso também pega
    # casos em que o operador loga via aba Sardela — a sessão CAS é
    # compartilhada entre abas do mesmo Chromium.
    log.info("Aguardando login e-SAJ (até %ds)...", timeout)
    start = time.time()
    logged = False
    while time.time() - start < timeout:
        try:
            if _is_esaj_logged_in(driver):
                log.info("Login e-SAJ detectado após %.0fs", time.time() - start)
                time.sleep(1)  # pequena espera pra CAS redirect assentar
                logged = True
                break
        except Exception:
            pass
        time.sleep(1)

    if not logged:
        log.warning("Timeout login e-SAJ (%ds) — consultas podem falhar", timeout)

    _restore_granola_tab()
    return logged


def _connect_driver() -> tuple[webdriver.Chrome | None, str | None]:
    """
    Conecta Selenium ao Chromium via CDP. Abre aba própria para não atrapalhar Sardela.

    Retorna (driver, erro). Em sucesso: (driver, None). Em falha: (None, "mensagem detalhada").

    Trata o bug de versão do chromedriver cacheado (v147 com Chromium v146) apontando
    diretamente pra chromedriver compatível via Service(executable_path=...). Se não achar
    no cache, tenta o Selenium Manager com browser_version forçado; em último caso retorna
    a exceção bruta.
    """
    opts = Options()
    opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{CDP_PORT}")

    def _finalize(driver: webdriver.Chrome) -> tuple[webdriver.Chrome, None]:
        try:
            driver.execute_cdp_cmd("Emulation.setFocusEmulationEnabled", {"enabled": True})
        except Exception:
            pass

        # Só reusa abas CLARAMENTE vazias (about:blank ou newtab). NUNCA reusa
        # abas com URL real — mesmo cpopg/open.do pode ser uma aba que o
        # Sardela ou o operador deixou aberta, e reusá-la causaria hijacking:
        # _extrair_movimentacoes navegaria a aba do Sardela, e depois o
        # driver.close() do finally fecharia ela.
        reused = False
        try:
            for h in list(driver.window_handles):
                try:
                    driver.switch_to.window(h)
                    url = driver.current_url or ""
                    if url in ("about:blank", "", "chrome://newtab/", "chrome://new-tab-page/"):
                        reused = True
                        break
                except Exception:
                    continue
        except Exception:
            pass

        # Se não achou nenhuma aba vazia, cria uma nova (Selenium 4 idiomático).
        # Aceita o overhead de ficar com uma aba extra quando _launch_chromium
        # acabou de abrir Chromium com open.do — é o preço de não hijackar
        # abas de terceiros.
        if not reused:
            try:
                driver.switch_to.new_window("tab")
            except Exception:
                # Fallback para JS window.open (Selenium antigo)
                driver.execute_script("window.open('about:blank')")
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

    # Tentativa 3: Selenium Manager default (provavelmente vai falhar, mas propaga erro real)
    try:
        driver = webdriver.Chrome(options=opts)
        return _finalize(driver)
    except Exception as e:
        msg = str(e).split("Stacktrace")[0].strip()
        log.error("Erro conectando ao Chromium: %s", msg)
        return None, msg


# ============================================================
#  Extração de movimentações
# ============================================================
def _detectar_grau_esaj(numero_cnj: str, link_autos: str | None = None, fase: str | None = None) -> str:
    """
    Decide se processo deve ser consultado em 1º ou 2º grau e-SAJ.
    Retorna '1' ou '2'.

    Regras (ordem de prioridade):
      1. link_autos explícito: se contém 'cposg' → 2G, 'cpopg' → 1G
      2. Fase do processo: recurso/acordao/segundo grau → 2G
      3. Foro do CNJ: TJSP '0000' é sede (2º grau), qualquer outro foro é 1G
    """
    if link_autos:
        lo = link_autos.lower()
        if "cposg" in lo:
            return "2"
        if "cpopg" in lo:
            return "1"
    if fase:
        f = fase.lower()
        if any(k in f for k in ("recurso", "acord", "segundo grau", "2g", "2o grau", "apela")):
            return "2"
    m = PROCESSO_RE.search(numero_cnj)
    if m and m.group(2) == "0000":
        return "2"
    return "1"


def _build_search_url(numero_cnj: str, grau: str = "1") -> str | None:
    """Monta URL de pesquisa a partir do número CNJ no grau correto."""
    m = PROCESSO_RE.search(numero_cnj)
    if not m:
        return None
    numero_ano = m.group(1)   # ex: 1006696-09.2022
    foro = m.group(2)         # ex: 0602
    base = ESAJ_BASE_2G if grau == "2" else ESAJ_BASE_1G
    return (
        f"{base}/search.do?"
        f"conversationId=&cbPesquisa=NUMPROC"
        f"&numeroDigitoAnoUnificado={numero_ano}"
        f"&foroNumeroUnificado={foro}"
        f"&dadosConsulta.valorConsultaNuUnificado={numero_cnj}"
        f"&dadosConsulta.valorConsulta="
        f"&dadosConsulta.tipoNuProcesso=UNIFICADO"
    )


def _extrair_movimentacoes(driver: webdriver.Chrome, numero_cnj: str,
                           link_autos: str = None, fase: str = None) -> list[dict]:
    """
    Navega até o processo e extrai as 2 últimas movimentações.
    Se link_autos fornecido, navega diretamente para ele.
    Caso contrário, decide 1º ou 2º grau via _detectar_grau_esaj().

    Blindagem contra processos em segredo de justiça:
      - Fecha alert() JS antes de qualquer operação Selenium (evita
        UnexpectedAlertPresentException que matava a thread da coleta)
      - Se a página redireciona para login CAS, retorna [] sem erro
    """
    # Fecha qualquer alert pendente antes de navegar (segredo de justiça às vezes
    # dispara alert JS ao carregar a página, o que trava o Selenium)
    _dismiss_alert_if_present(driver)

    grau = _detectar_grau_esaj(numero_cnj, link_autos=link_autos, fase=fase)
    if link_autos:
        url = link_autos
    else:
        url = _build_search_url(numero_cnj, grau=grau)
        if not url:
            log.warning("Número CNJ inválido: %s", numero_cnj)
            return []
        log.info("[%s] consultando em %s grau", numero_cnj, "2º" if grau == "2" else "1º")

    try:
        driver.get(url)
    except Exception as e:
        # Alert JS no onload trava driver.get — tenta fechar e seguir
        if "alert" in str(e).lower():
            _dismiss_alert_if_present(driver)
        else:
            log.warning("Erro navegando %s: %s", numero_cnj, e)
            return []

    # Espera o redirect search.do → show.do
    end = time.time() + 10
    while time.time() < end:
        try:
            if "show.do" in (driver.current_url or ""):
                break
        except Exception:
            _dismiss_alert_if_present(driver)
        time.sleep(0.5)

    # Se redirecionou para login CAS, o usuário não está logado — aborta sem crash
    try:
        cur = driver.current_url or ""
    except Exception:
        _dismiss_alert_if_present(driver)
        cur = ""
    if "sso.cloud" in cur or "auth/realms" in cur or "login" in cur.lower():
        log.info("Processo %s redirecionou pra login (requer login)", numero_cnj)
        return [{"_requer_login": True}]

    # Verifica se o processo foi encontrado (show.do vale para cpopg e cposg)
    if not link_autos and "show.do" not in cur:
        # Fallback: se tentamos 1º grau e não achou, tentar 2º grau (e vice-versa)
        outro_grau = "2" if grau == "1" else "1"
        log.info("Processo %s não encontrado no %sº grau — tentando %sº grau",
                 numero_cnj, grau, outro_grau)
        url2 = _build_search_url(numero_cnj, grau=outro_grau)
        if url2:
            try:
                driver.get(url2)
                end = time.time() + 10
                while time.time() < end:
                    try:
                        if "show.do" in (driver.current_url or ""):
                            break
                    except Exception:
                        _dismiss_alert_if_present(driver)
                    time.sleep(0.5)
            except Exception as e:
                if "alert" in str(e).lower():
                    _dismiss_alert_if_present(driver)
                else:
                    log.warning("Erro no fallback de grau %s: %s", numero_cnj, e)
                    return []
        try:
            cur = driver.current_url or ""
        except Exception:
            cur = ""
        if "show.do" not in cur:
            log.info("Processo não encontrado no e-SAJ (1g e 2g): %s", numero_cnj)
            return []

    # Espera o DOM carregar e detecta segredo de justiça / senha
    try:
        items = []
        for _ in range(20):
            time.sleep(0.5)
            _dismiss_alert_if_present(driver)
            raw = driver.execute_script("""
                // Detecta popup de senha VISÍVEL (segredo de justiça / resolução 121 CNJ)
                var senhaInput = document.getElementById('senhaProcesso');
                var popupModal = document.getElementById('popupModalDiv');
                var senhaVisivel = senhaInput && senhaInput.offsetParent !== null;
                var popupVisivel = popupModal && popupModal.offsetParent !== null;
                if (senhaVisivel || popupVisivel) {
                    return '__REQUER_LOGIN__';
                }
                var tbody = document.getElementById('tabelaUltimasMovimentacoes');
                if (!tbody) return '';
                var rows = tbody.querySelectorAll('tr');
                if (rows.length === 0) return '';
                var result = [];
                for (var i = 0; i < Math.min(rows.length, 2); i++) {
                    var tds = rows[i].querySelectorAll('td');
                    if (tds.length < 3) continue;
                    var data = tds[0].textContent.trim();
                    var desc = tds[2].textContent.trim();
                    result.push({data: data, descricao: desc});
                }
                return JSON.stringify(result);
            """)
            if raw == "__REQUER_LOGIN__":
                return [{"_requer_login": True}]
            if raw:
                items = json.loads(raw)
                break
    except Exception as e:
        log.info("Sem movimentações visíveis: %s (%s)", numero_cnj, e)
        return []

    movs = []
    for item in items:
        data_mov = item.get("data", "")
        descricao_completa = item.get("descricao", "")
        if not data_mov or not descricao_completa:
            continue

        # Limpa tabs/espaços extras
        descricao_completa = re.sub(r"\t+", "", descricao_completa).strip()
        descricao_completa = re.sub(r"\n{2,}", "\n", descricao_completa)

        # Primeira linha = título da movimentação
        linhas = descricao_completa.split("\n")
        titulo = linhas[0].strip() if linhas else descricao_completa[:100]

        h = _hash_mov(numero_cnj, data_mov, descricao_completa)
        movs.append({
            "data": data_mov,
            "titulo": titulo,
            "descricao": descricao_completa,
            "hash": h,
        })

    return movs


# ============================================================
#  Persistência
# ============================================================
def _salvar_movimentacoes(db_conn, processo_id: int, numero_cnj: str, movs: list[dict]) -> list[dict]:
    """
    Salva movimentações novas no banco. Retorna lista das NOVAS (que não existiam).

    Dedup em 2 camadas:
      1. hash_dedup (rápido — usa o hash normalizado de _hash_mov)
      2. Fallback por conteúdo normalizado contra movs já no banco desse processo
         (pega duplicatas antigas cujo hash foi gerado com texto cru, antes do
         fix de normalização, e evita re-inserção enquanto o backfill não roda)
    """
    novas = []
    now = datetime.now().isoformat()

    # Carrega uma vez só as movs existentes desse processo para o fallback de conteúdo
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
        # Camada 1: hash direto (padrão novo)
        if mov["hash"] in hashes_existentes:
            continue

        # Camada 2: assinatura (data normalizada + texto normalizado)
        assinatura = (_normalize_date(mov["data"]), _normalize_text(mov["descricao"]))
        if assinatura in assinaturas_existentes:
            log.debug("Mov %s já existe (match por conteúdo normalizado)", numero_cnj)
            continue

        try:
            db_conn.execute(
                """INSERT INTO granola_movimentacoes
                   (processo_id, tipo, descricao, data_movimento, fonte, hash_dedup, criado_em)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    processo_id,
                    mov["titulo"][:100],
                    mov["descricao"],
                    mov["data"],
                    "esaj_auto",
                    mov["hash"],
                    now,
                )
            )
            novas.append(mov)
            # Evita duplicata dentro do mesmo batch (e-SAJ pode retornar 2 movs iguais)
            hashes_existentes.add(mov["hash"])
            assinaturas_existentes.add(assinatura)
        except Exception as e:
            log.warning("Erro salvando movimentação %s: %s", numero_cnj, e)

    if novas:
        db_conn.commit()

    return novas


# ============================================================
#  Coleta principal
# ============================================================
def coletar_publicacoes(callback=None, processo_ids=None) -> dict:
    """
    Coleta publicações e-SAJ.

    processo_ids: lista opcional de IDs de processos para coletar.
                  Se None, coleta todos os processos e-SAJ.
    """
    global _running
    if _running:
        return {"error": "Coleta já em andamento"}

    _running = True
    _pause_event_esaj.clear()  # garante que não está pausado herdado de coleta anterior
    _atualizar_progresso_esaj(em_andamento=True, index=0, total=0, novas=0, erros=0,
                              processo_atual=None, processo_atual_titulo=None,
                              status="Iniciando e-SAJ...", etapa="inicio")
    modo = "reteste" if processo_ids else "completa"
    append_log("esaj", "info", f"Coleta e-SAJ iniciada ({modo})")
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
        # 1. Abre/conecta Chromium
        chromium_ja_rodava = _chromium_is_running()
        if not chromium_ja_rodava:
            if not _launch_chromium():
                resultado["erros"].append("Falha ao abrir Chromium")
                append_log("esaj", "error", "Falha ao abrir Chromium")
                return resultado

        driver, err_conn = _connect_driver()
        if not driver:
            msg = f"Falha ao conectar no Chromium: {err_conn}" if err_conn else "Falha ao conectar no Chromium"
            resultado["erros"].append(msg)
            append_log("esaj", "error", msg)
            return resultado

        # Aguardar operador logar no e-SAJ. _wait_for_login agora:
        #   - Verifica se QUALQUER aba já está logada (short-circuit imediato)
        #   - Se não, força navegação da aba _granola pra open.do (tela de login
        #     fica visível — essencial para o fluxo de reteste de processo em
        #     segredo de justiça, que antes navegava direto pra URL protegida
        #     sem login e travava o Selenium)
        #   - Aguarda polling de até TIMEOUT_LOGIN_ESAJ
        logado = _wait_for_login(driver, timeout=TIMEOUT_LOGIN_ESAJ)
        if not logado:
            # Login não concluído: emite aviso mas NÃO aborta — algumas consultas
            # podem funcionar mesmo sem CAS (processos públicos), e se for segredo
            # de justiça, _extrair_movimentacoes detecta e marca como requer_login.
            append_log("esaj", "warn",
                       "Login e-SAJ não detectado — consultas públicas podem funcionar, "
                       "segredo de justiça vai retornar 'requer login'")

        # 2. Busca processos e-SAJ do banco
        conn = get_connection()
        if processo_ids:
            placeholders = ",".join("?" for _ in processo_ids)
            processos = conn.execute(
                f"""SELECT id, numero_cnj, titulo, status, fase, link_autos FROM granola_processos
                   WHERE id IN ({placeholders})
                   ORDER BY numero_cnj""",
                processo_ids
            ).fetchall()
        else:
            processos = conn.execute(
                """SELECT id, numero_cnj, titulo, status, fase, link_autos FROM granola_processos
                   WHERE numero_cnj IS NOT NULL
                   AND numero_cnj LIKE '%%.8.26.%%'
                   ORDER BY numero_cnj"""
            ).fetchall()

        resultado["total"] = len(processos)
        log.info("Iniciando coleta de publicações: %d processos e-SAJ", len(processos))
        append_log("esaj", "info", f"e-SAJ: {len(processos)} processo(s) na fila")

        if callback:
            callback("inicio", {"total": len(processos)})

        # 3. Para cada processo, busca as 2 últimas movimentações
        #    Processos que requerem login são separados para o final
        pendentes_login = []

        def _processar(proc, index, total):
            numero_cnj = proc["numero_cnj"]
            processo_id = proc["id"]
            try:
                link_autos = proc["link_autos"] or None
            except (KeyError, IndexError):
                link_autos = None
            try:
                fase = proc["fase"] or None
            except (KeyError, IndexError):
                fase = None
            _atualizar_progresso_esaj(
                processo_atual=numero_cnj,
                processo_atual_titulo=proc["titulo"],
                index=index, total=total,
                status=f"[e-SAJ] {numero_cnj}",
                etapa="coletando",
            )
            append_log("esaj", "info",
                       f"[{index}/{total}] Consultando {numero_cnj}"
                       + (f" — {proc['titulo']}" if proc['titulo'] else ""),
                       processo=numero_cnj)

            try:
                movs = _extrair_movimentacoes(driver, numero_cnj, link_autos=link_autos, fase=fase)
                resultado["consultados"] += 1

                # Detecta processos que requerem login (segredo de justiça)
                if movs and movs[0].get("_requer_login"):
                    resultado["requer_login"].append({
                        "processo": numero_cnj,
                        "processo_id": processo_id,
                        "titulo_processo": proc["titulo"],
                    })
                    log.info("Processo requer login: %s", numero_cnj)
                    append_log("esaj", "warn",
                               f"  → {numero_cnj} em segredo de justiça (requer login)",
                               processo=numero_cnj)
                    if callback:
                        callback("processo", {
                            "numero": numero_cnj,
                            "index": index,
                            "total": total,
                            "status": "requer login (segredo de justiça)",
                            "novas": 0,
                        })
                    return

                novas = []
                if movs:
                    novas = _salvar_movimentacoes(conn, processo_id, numero_cnj, movs)
                    if novas:
                        resultado["com_novidade"] += 1
                        _atualizar_progresso_esaj(novas=_progresso_esaj["novas"] + len(novas))
                        for n in novas:
                            resultado["novas_movimentacoes"].append({
                                "processo": numero_cnj,
                                "processo_id": processo_id,
                                "titulo_processo": proc["titulo"],
                                "data": n["data"],
                                "titulo": n["titulo"],
                                "descricao": n["descricao"],
                            })

                status = f"ok ({len(movs)} movs)" if movs else "sem movimentações"
                if movs:
                    nivel = "success" if novas else "info"
                    append_log("esaj", nivel,
                               f"  → {len(movs)} mov(s) retornada(s), {len(novas)} nova(s)",
                               processo=numero_cnj)
                else:
                    append_log("esaj", "info",
                               f"  → {numero_cnj}: sem movimentações visíveis",
                               processo=numero_cnj)
                if callback:
                    callback("processo", {
                        "numero": numero_cnj,
                        "index": index,
                        "total": total,
                        "status": status,
                        "novas": len(novas),
                    })

            except Exception as e:
                erro = f"{numero_cnj}: {e}"
                resultado["erros"].append(erro)
                log.error("Erro em %s: %s", numero_cnj, e)
                _atualizar_progresso_esaj(erros=_progresso_esaj["erros"] + 1)
                append_log("esaj", "error", f"  → ERRO: {e}", processo=numero_cnj)
                if callback:
                    callback("erro", {"numero": numero_cnj, "erro": str(e)})

        # Primeira passada: processos normais
        for i, proc in enumerate(processos):
            # Bloqueia aqui se operador clicou em pausar; libera no resume.
            # Verificar ANTES de processar para que o processo que parou não fique
            # no meio do caminho (ex: consulta feita mas não salva).
            _wait_if_paused_esaj()
            _processar(proc, i + 1, len(processos))
            if i < len(processos) - 1:
                time.sleep(SLEEP_ENTRE_PROCESSOS)

        # Reporta processos que requerem login
        if resultado["requer_login"]:
            log.info(
                "%d processo(s) requerem login para consulta (segredo de justiça):",
                len(resultado["requer_login"])
            )
            for p in resultado["requer_login"]:
                log.info("  - %s (%s)", p["processo"], p.get("titulo_processo", ""))
            if callback:
                callback("requer_login", {
                    "processos": resultado["requer_login"],
                    "mensagem": (
                        f"{len(resultado['requer_login'])} processo(s) em segredo de justiça "
                        "necessitam login/identificação para consulta de publicações."
                    ),
                })

        conn.close()

    except Exception as e:
        resultado["erros"].append(f"Erro geral: {e}")
        log.error("Erro geral na coleta: %s", e)
        append_log("esaj", "error", f"Erro geral na coleta: {e}")

    finally:
        _running = False
        _pause_event_esaj.clear()  # sempre limpa pause ao terminar (evita stuck em nova run)
        _atualizar_progresso_esaj(em_andamento=False, etapa="finalizado",
                                  status="Coleta e-SAJ concluida",
                                  processo_atual=None, processo_atual_titulo=None)
        append_log(
            "esaj",
            "success" if not resultado["erros"] else "warn",
            f"Coleta e-SAJ finalizada: {resultado['consultados']}/{resultado['total']} "
            f"consultados, {len(resultado['novas_movimentacoes'])} nova(s), "
            f"{len(resultado['erros'])} erro(s)"
        )
        resultado["fim"] = datetime.now().isoformat()
        # Fechar a aba _granola — EXCETO quando processos em segredo de justiça
        # precisam de interação manual do operador (digitar senha do processo).
        # Nesse caso, deixa a aba aberta no e-SAJ pra que o operador possa
        # preencher a senha e continuar a consulta manualmente.
        # NUNCA usar driver.quit() (mata o Sardela).
        if driver:
            tem_segredo = bool(resultado["requer_login"])
            if tem_segredo:
                # Deixa a aba aberta. Navega de volta pra aba _granola pra
                # garantir que o operador está vendo a página do processo
                # (e não uma aba aleatória do Sardela).
                append_log(
                    "esaj",
                    "warn",
                    f"{len(resultado['requer_login'])} processo(s) em segredo de justiça — "
                    "a aba do e-SAJ foi mantida aberta. Digite a senha do processo "
                    "no Chromium pra liberar a consulta manualmente."
                )
                log.info(
                    "Mantendo aba _granola aberta (%d processos em segredo de justiça)",
                    len(resultado["requer_login"])
                )
            else:
                try:
                    driver.close()  # fecha só a aba atual
                except Exception:
                    pass

    log.info(
        "Coleta concluída: %d consultados, %d com novidade, %d novas movimentações",
        resultado["consultados"],
        resultado["com_novidade"],
        len(resultado["novas_movimentacoes"]),
    )

    if callback:
        callback("fim", resultado)

    return resultado


# ============================================================
#  Execução automática diária
# ============================================================
def verificar_coleta_diaria():
    """
    Verifica se já rodou hoje. Se não, dispara coleta em background.
    Chamado pelo server.py no main().
    """
    global _last_run_date

    hoje = date.today()

    # Checa na memória
    if _last_run_date == hoje:
        return False

    # Checa no banco (campo config)
    try:
        conn = get_connection()
        row = conn.execute(
            "SELECT value FROM granola_config WHERE key = 'ultima_coleta_publicacoes'"
        ).fetchone()
        conn.close()

        if row and row["value"]:
            ultima = datetime.fromisoformat(row["value"]).date()
            if ultima == hoje:
                _last_run_date = hoje
                return False
    except Exception:
        pass

    # Não rodou hoje — disparar em thread
    log.info("Primeira inicialização do dia — agendando coleta de publicações")
    _last_run_date = hoje

    def _run_coleta():
        # Aguarda 5 segundos para o servidor estar pronto
        time.sleep(5)
        log.info("Iniciando coleta automática de publicações...")
        resultado = coletar_publicacoes()

        # Salva timestamp da coleta
        try:
            conn = get_connection()
            now = datetime.now().isoformat()
            conn.execute(
                """INSERT OR REPLACE INTO granola_config (key, value, atualizado_em)
                   VALUES ('ultima_coleta_publicacoes', ?, ?)""",
                (now, now)
            )
            # Salva resumo da última coleta
            conn.execute(
                """INSERT OR REPLACE INTO granola_config (key, value, atualizado_em)
                   VALUES ('ultima_coleta_resumo', ?, ?)""",
                (json.dumps(resultado, ensure_ascii=False, default=str), now)
            )
            conn.commit()
            conn.close()
        except Exception as e:
            log.error("Erro salvando config de coleta: %s", e)

    t = threading.Thread(target=_run_coleta, daemon=True, name="coleta-publicacoes")
    t.start()
    return True


def get_status_coleta() -> dict:
    """Retorna status da última coleta (para API)."""
    try:
        conn = get_connection()
        row = conn.execute(
            "SELECT value FROM granola_config WHERE key = 'ultima_coleta_resumo'"
        ).fetchone()
        ts_row = conn.execute(
            "SELECT value FROM granola_config WHERE key = 'ultima_coleta_publicacoes'"
        ).fetchone()
        conn.close()

        return {
            "ultima_coleta": ts_row["value"] if ts_row else None,
            "resumo": json.loads(row["value"]) if row else None,
            "em_andamento": _running,
        }
    except Exception:
        return {"ultima_coleta": None, "resumo": None, "em_andamento": _running}
