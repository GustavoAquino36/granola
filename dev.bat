@echo off
REM ============================================================
REM  Granola - Dev launcher
REM  Sobe backend (Python :3458) + frontend (Vite :5173) em paralelo.
REM
REM  Se Windows Terminal (wt.exe) estiver disponivel (padrao no Windows 11),
REM  abre UMA janela com 2 paneis split horizontal. Caso contrario, cai
REM  num fallback com 2 terminais cmd classicos.
REM ============================================================

title Granola - Dev launcher
cd /d "%~dp0"

REM ---------- Verifica pre-requisitos ----------
if not exist ".venv\Scripts\activate.bat" (
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
  echo [Granola] ERRO: frontend\node_modules nao encontrado.
  echo.
  echo Rode o setup do frontend primeiro:
  echo     cd frontend
  echo     npm install
  echo.
  pause
  exit /b 1
)

REM ---------- Windows Terminal: 1 janela, 2 paneis ----------
where wt >nul 2>&1
if %errorlevel% equ 0 (
  echo [Granola] Subindo backend + frontend em 1 janela do Windows Terminal...
  wt new-tab --title "Granola backend :3458" -d "%~dp0" cmd /k ".venv\Scripts\activate.bat && python -m granola" ^; split-pane -H --title "Granola frontend :5173" -d "%~dp0frontend" cmd /k "npm run dev"
  exit /b 0
)

REM ---------- Fallback: 2 terminais cmd classicos ----------
echo [Granola] Windows Terminal nao encontrado. Abrindo 2 terminais classicos...
start "Granola backend :3458" cmd /k ".venv\Scripts\activate.bat && python -m granola"
start "Granola frontend :5173" cmd /k "cd frontend && npm run dev"
echo.
echo [Granola] Dois terminais abertos. Feche-os para encerrar o dev.
timeout /t 3 /nobreak >nul
