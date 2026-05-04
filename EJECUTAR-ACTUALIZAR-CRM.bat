@echo off
color 0A
title Kupe CRM - Actualizacion de datos

echo.
echo ===============================================================
echo   Kupe CRM - Actualizacion unificada de datos (3 fuentes)
echo ===============================================================
echo.

cd /d "%~dp0"

if exist "scripts\update-data.cjs" (
    node scripts/update-data.cjs
) else (
    echo ERROR: No se encontro scripts\update-data.cjs
    echo.
    pause
    exit /b 1
)

echo.
echo ===============================================================
echo   Actualizacion completada
echo ===============================================================
echo.
pause
