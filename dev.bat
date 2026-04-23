@echo off
REM ============================================================
REM  Granola - Dev launcher
REM  Sobe backend Python (:3458) + frontend Vite (:5173) em
REM  duas janelas cmd separadas. Titulos identificaveis, logs
REM  independentes, cada Ctrl+C/fechamento encerra seu proprio
REM  processo sem derrubar o outro.
REM
REM  Quer rodar tudo numa janela so? Abra o Windows Terminal,
REM  use Ctrl+Shift+D pra split horizontal, e rode os comandos
REM  do README.md manualmente nos 2 paneis. (A tentativa de
REM  automatizar isso num .bat esbarra no escaping de ; com
REM  paths contendo espacos + acentos — nao vale a dor.)
REM ============================================================

title Granola - Dev launcher
cd /d "%~dp0"

REM ---------- Pre-requisitos ----------
if not exist ".venv\Scripts\activate.bat" (
  echo.
  echo [Granola] ERRO: .venv nao encontrado.
  echo.
  echo Rode o setup primeiro:
  echo     python -m venv .venv
  echo     .venv\Scripts\activate
  echo     pip install -r requirements.txt
  echo.
  pause
  exit /b 1
)

if not exist "frontend\node_modules" (
  echo.
  echo [Granola] ERRO: frontend\node_modules nao encontrado.
  echo.
  echo Rode o setup do frontend primeiro:
  echo     cd frontend
  echo     npm install
  echo.
  pause
  exit /b 1
)

REM ---------- Sobe backend + frontend em 2 janelas ----------
echo.
echo [Granola] Abrindo backend (porta 3458) + frontend Vite (porta 5173)...
echo           Acesse http://localhost:5173 no browser.
echo           Feche as janelas de cmd pra encerrar cada servico.
echo.

start "Granola backend :3458" /d "%~dp0" cmd /k ".venv\Scripts\activate.bat && python -m granola"
start "Granola frontend :5173" /d "%~dp0frontend" cmd /k "npm run dev"

REM Pequena pausa pra voce ver o que aconteceu antes da janela fechar.
timeout /t 3 /nobreak >nul
exit /b 0
