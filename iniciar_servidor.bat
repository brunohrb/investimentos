@echo off
chcp 65001 >nul
title InvestFlow — Servidor

:: Verifica se já está rodando
python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/status')" >nul 2>&1
if not errorlevel 1 (
    echo Servidor já está rodando.
    timeout /t 2 /nobreak >nul
    exit /b 0
)

echo Iniciando InvestFlow...
start /min "" python "%~dp0scripts\servidor.py"
timeout /t 2 /nobreak >nul

python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/status')" >nul 2>&1
if not errorlevel 1 (
    echo [OK] Servidor rodando. Pode fechar esta janela.
) else (
    echo [!] Servidor não respondeu. Verifique se rodou instalar.bat
    pause
)
