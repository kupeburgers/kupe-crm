@echo off
chcp 65001 >nul
echo.
echo ================================================
echo   KUPE CRM — Delivery
echo ================================================
echo.
echo  ANTES DE CONTINUAR:
echo  Asegurate de que el archivo descargado
echo  se llame exactamente:  delivery.xlsx
echo  y este en esta misma carpeta.
echo.
pause

echo  Procesando delivery...
echo.

"C:\Program Files\nodejs\node.exe" "C:\Users\kupeb\OneDrive\Escritorio\supabase crm\scripts\update-data.cjs"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR — Revisa que el archivo delivery.xlsx este en esta carpeta.
    pause
    exit /b 1
)

echo.
echo ================================================
echo   Listo! Podes cerrar esta ventana.
echo ================================================
echo.
pause
