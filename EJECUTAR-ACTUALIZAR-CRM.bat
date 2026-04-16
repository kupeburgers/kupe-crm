@echo off
chcp 65001 >nul
color 0A
title 🚀 Kupe CRM — Actualización de datos

echo.
echo ═══════════════════════════════════════════════════════════════
echo   🚀 Kupe CRM — Actualización unificada de datos (3 fuentes)
echo ═══════════════════════════════════════════════════════════════
echo.

cd /d "%~dp0"

if exist "scripts\update-data.cjs" (
    node scripts/update-data.cjs
) else (
    echo ❌ Error: No se encontró scripts\update-data.cjs
    echo.
    pause
    exit /b 1
)

echo.
echo ═══════════════════════════════════════════════════════════════
echo   ✅ Actualización completada
echo ═══════════════════════════════════════════════════════════════
echo.
pause
