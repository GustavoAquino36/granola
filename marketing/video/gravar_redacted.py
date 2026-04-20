"""Gravacao automatizada COM redacao de dados sensiveis.

Mesma estrutura do gravar.py, mas injeta redact.js em toda pagina
para borrar/tapar nomes de clientes, CNJs, nomes de pessoas.
"""
from playwright.sync_api import sync_playwright
import time, os

URL = "http://localhost:3458/"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def smooth_scroll(page, top):
    page.evaluate(f"window.scrollTo({{top:{top},behavior:'smooth'}})")


def run():
    with open(os.path.join(OUT_DIR, "redact.js"), encoding="utf-8") as f:
        redact_js = f.read()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--disable-dev-shm-usage"])
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=OUT_DIR,
            record_video_size={"width": 1440, "height": 900},
        )
        context.add_init_script(redact_js)
        page = context.new_page()

        # LOGIN (0-6s)
        page.goto(URL, wait_until="domcontentloaded")
        time.sleep(1.2)
        page.fill('input[type="text"]', "admin")
        time.sleep(0.4)
        page.fill('input[type="password"]', "granola2026")
        time.sleep(0.6)
        page.click('button[type="submit"]')
        time.sleep(3.2)

        # DASHBOARD hero (6-14s)
        smooth_scroll(page, 0); time.sleep(2.0)
        smooth_scroll(page, 400); time.sleep(2.5)
        smooth_scroll(page, 800); time.sleep(2.0)
        smooth_scroll(page, 0); time.sleep(1.5)

        # PROCESSOS (14-20s)
        page.click('[data-page="processos"]'); time.sleep(2.0)
        smooth_scroll(page, 300); time.sleep(2.0)
        smooth_scroll(page, 0); time.sleep(2.0)

        # KANBAN (20-26s)
        page.click('[data-page="kanban"]'); time.sleep(3.0)
        page.evaluate(
            "document.querySelector('.kanban-board,main')?.scrollBy({left:400,behavior:'smooth'})"
        )
        time.sleep(3.0)

        # PRAZOS (26-34s)
        page.click('[data-page="prazos"]'); time.sleep(3.5)
        smooth_scroll(page, 200); time.sleep(4.5)

        # FINANCEIRO (34-40s) — foco nos cards superiores (valores)
        page.click('[data-page="financeiro"]'); time.sleep(3.0)
        smooth_scroll(page, 100); time.sleep(3.0)

        # AGENDA (40-44s) — so datas, seguro
        page.click('[data-page="agenda"]'); time.sleep(4.0)

        # PORTABILIDADE / MOBILE (44-52s)
        page.click('[data-page="dashboard"]'); time.sleep(1.5)
        for w in [1300, 1150, 1000, 850, 700, 550, 450, 375]:
            page.set_viewport_size({"width": w, "height": 812})
            time.sleep(0.55)
        time.sleep(2.0)

        # OUTRO (52-56s)
        page.set_viewport_size({"width": 1440, "height": 900})
        page.click('[data-page="dashboard"]'); time.sleep(3.5)

        context.close()
        browser.close()

        import glob
        files = sorted(glob.glob(os.path.join(OUT_DIR, "*.webm")), key=os.path.getmtime)
        if files:
            dst = os.path.join(OUT_DIR, "granola_red_raw.webm")
            if os.path.exists(dst):
                os.remove(dst)
            os.rename(files[-1], dst)
            print("saved:", dst)


if __name__ == "__main__":
    run()
