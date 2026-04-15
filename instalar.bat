@echo off
chcp 65001 >nul
title InvestFlow — Instalação

echo.
echo =====================================================
echo   InvestFlow — Instalação da Automação de Bancos
echo =====================================================
echo.

:: ── Verifica Python ────────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [!] Python não encontrado. Instalando via winget...
    winget install --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo Não foi possível instalar automaticamente.
        echo Acesse https://www.python.org/downloads/
        echo Marque "Add Python to PATH" durante a instalação.
        pause & exit /b 1
    )
    echo Python instalado! Reiniciando instalação...
    start "" "%~f0"
    exit /b 0
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo [OK] %%v

:: ── Instala pacotes ────────────────────────────────────────────────────────
echo.
echo Instalando pacotes Python...
python -m pip install --upgrade pip --quiet
python -m pip install -r "%~dp0scripts\requirements.txt" --quiet
if errorlevel 1 ( echo [!] Erro ao instalar pacotes. & pause & exit /b 1 )
echo [OK] Pacotes instalados.

:: ── Instala Chromium ──────────────────────────────────────────────────────
echo.
echo Instalando Chromium (browser de automação)...
python -m playwright install chromium
if errorlevel 1 ( echo [!] Erro ao instalar Chromium. & pause & exit /b 1 )
echo [OK] Chromium instalado.

:: ── Registra servidor no Windows Startup ──────────────────────────────────
echo.
echo Registrando servidor para iniciar com o Windows...

set "SERVIDOR=%~dp0scripts\servidor.py"
set "PYTHONW=%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"

:: Tenta encontrar pythonw
where pythonw >nul 2>&1
if not errorlevel 1 (
    set "PYTHONW=pythonw"
)

schtasks /create /tn "InvestFlow" ^
    /tr "\"%PYTHONW%\" \"%SERVIDOR%\"" ^
    /sc ONLOGON /rl HIGHEST /f >nul 2>&1

if errorlevel 1 (
    echo [!] Não foi possível registrar no startup automático.
    echo     Use iniciar_servidor.bat para iniciar manualmente.
) else (
    echo [OK] Servidor registrado para iniciar com o Windows.
)

:: ── Inicia o servidor agora ───────────────────────────────────────────────
echo.
echo Iniciando servidor agora...
start /min "" python "%~dp0scripts\servidor.py"
timeout /t 2 /nobreak >nul

:: Verifica se subiu
python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/status')" >nul 2>&1
if not errorlevel 1 (
    echo [OK] Servidor rodando em http://localhost:8765
) else (
    echo [!] Servidor ainda não respondeu — tente iniciar_servidor.bat
)

echo.
echo =====================================================
echo   [OK] Instalação concluída! Sem reiniciar.
echo.
echo   Pode usar agora: no app clique em
echo   "Sincronizar XP" para começar.
echo.
echo   (Nas proximas vezes que ligar o PC, o servidor
echo    sobe sozinho em background automaticamente.)
echo =====================================================
echo.
pause
