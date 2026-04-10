@echo off
chcp 65001 >nul
echo.
echo ================================================
echo   KUPE CRM — Pedidos
echo ================================================
echo.
echo  Paso 1/2 — Procesando archivos Excel...
echo.

"C:\Python314\python.exe" "C:\Users\kupeb\OneDrive\Escritorio\supabase crm\scripts\parse_pedidos.py"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR — Revisa que los archivos Excel esten en esta carpeta.
    pause
    exit /b 1
)

echo.
echo  Paso 2/2 — Subiendo perfiles al CRM...
echo.

"C:\Program Files\nodejs\node.exe" "C:\Users\kupeb\OneDrive\Escritorio\supabase crm\scripts\cargar-perfil-productos.cjs"

echo.
echo ================================================
echo   Listo! Podes cerrar esta ventana.
echo ================================================
echo.
pause
