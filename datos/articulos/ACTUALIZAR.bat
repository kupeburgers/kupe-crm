@echo off
chcp 65001 >nul
echo.
echo ================================================
echo   KUPE CRM — Articulos Vendidos
echo ================================================
echo.
echo  Detectando archivos xlsx en esta carpeta...
echo.

"C:\Program Files\nodejs\node.exe" "C:\Users\kupeb\OneDrive\Escritorio\supabase crm\scripts\update-articulos.cjs"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR — Revisa que haya archivos .xlsx en esta carpeta.
    pause
    exit /b 1
)

echo.
echo ================================================
echo   Listo! Podes cerrar esta ventana.
echo ================================================
echo.
pause
