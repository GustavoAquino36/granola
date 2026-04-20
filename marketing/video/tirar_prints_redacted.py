"""Captura PNGs redacted das 16 cenas para entregar ao Claude Design."""
from playwright.sync_api import sync_playwright
import time, os

URL = "http://localhost:3458/"
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "claude_design_package", "prints")
os.makedirs(OUT, exist_ok=True)


def shot(page, name):
    path = os.path.join(OUT, name)
    page.screenshot(path=path, full_page=False)
    print("saved", name)


def run():
    with open(os.path.join(BASE, "redact.js"), encoding="utf-8") as f:
        redact_js = f.read()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_init_script(redact_js)
        page = ctx.new_page()

        page.goto(URL, wait_until="domcontentloaded")
        time.sleep(1.2)
        shot(page, "02_login_vazio.png")

        page.fill('input[type="text"]', "admin")
        page.fill('input[type="password"]', "granola2026")
        time.sleep(0.6)
        shot(page, "03_login_preenchido.png")

        page.click('button[type="submit"]')
        time.sleep(3.0)
        shot(page, "04_dashboard_hero.png")

        page.evaluate("window.scrollTo({top:500,behavior:'instant'})")
        time.sleep(1.2)
        shot(page, "05_dashboard_movimentacoes.png")
        page.evaluate("window.scrollTo({top:900,behavior:'instant'})")
        time.sleep(1.2)
        shot(page, "06_dashboard_publicacoes.png")
        page.evaluate("window.scrollTo({top:0,behavior:'instant'})")
        time.sleep(0.5)

        page.click('[data-page="clientes"]'); time.sleep(1.8)
        shot(page, "07_clientes.png")

        page.click('[data-page="processos"]'); time.sleep(1.8)
        shot(page, "08_processos.png")

        page.click('[data-page="kanban"]'); time.sleep(2.5)
        shot(page, "09_kanban.png")

        page.click('[data-page="prazos"]'); time.sleep(3.0)
        shot(page, "10_prazos_publicacoes.png")

        page.click('[data-page="financeiro"]'); time.sleep(2.5)
        shot(page, "11_financeiro.png")

        page.click('[data-page="agenda"]'); time.sleep(2.5)
        shot(page, "12_agenda.png")

        page.click('[data-page="admin"]'); time.sleep(2.0)
        shot(page, "13_admin.png")

        page.click('[data-page="dashboard"]'); time.sleep(1.5)
        page.set_viewport_size({"width": 375, "height": 812})
        time.sleep(1.8)
        shot(page, "14_mobile_dashboard.png")

        page.evaluate(
            "document.querySelectorAll('.mobile-nav-item').forEach(e=>{"
            "if(/financeiro/i.test(e.textContent)) e.click();})"
        )
        time.sleep(2.0)
        shot(page, "15_mobile_financeiro.png")

        page.set_viewport_size({"width": 1440, "height": 900})
        time.sleep(1.0)
        page.click('[data-page="dashboard"]'); time.sleep(2.0)
        shot(page, "16_outro_dashboard.png")

        ctx.close()
        browser.close()


if __name__ == "__main__":
    run()
