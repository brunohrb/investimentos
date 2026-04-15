@echo off
chcp 65001 >nul
title InvestFlow — Sincronizar XP

:: Verifica Python
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [!] Python não encontrado.
    echo     Execute primeiro:  instalar.bat
    echo.
    pause
    exit /b 1
)

:: Verifica se as dependências estão instaladas
python -c "import playwright, supabase, openpyxl" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [!] Pacotes não instalados.
    echo     Execute primeiro:  instalar.bat
    echo.
    pause
    exit /b 1
)

:: Executa o script
python "%~dp0scripts\sincronizar_xp.py"

if errorlevel 1 (
    echo.
    echo [!] O script terminou com erro.
    echo     Verifique as mensagens acima.
    pause
)
