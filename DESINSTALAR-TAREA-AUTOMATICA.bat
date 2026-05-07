@echo off
setlocal

REM Verificar permisos de administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo ===============================================================
    echo   ERROR: Se requieren permisos de administrador
    echo ===============================================================
    echo.
    echo   Cerra esta ventana, hace click DERECHO en
    echo   DESINSTALAR-TAREA-AUTOMATICA.bat y elegi
    echo   "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

color 0E

echo.
echo ===============================================================
echo   Kupe CRM - Desinstalacion de tareas automaticas
echo ===============================================================
echo.

echo [1/3] Eliminando KupeCRM-Daily ...
schtasks /Delete /TN "KupeCRM-Daily" /F >nul 2>&1
if %errorlevel% neq 0 echo    (ya no existia)

echo [2/3] Eliminando KupeCRM-Logon ...
schtasks /Delete /TN "KupeCRM-Logon" /F >nul 2>&1
if %errorlevel% neq 0 echo    (ya no existia)

echo [3/3] Eliminando KupeCRM-Shutdown ...
schtasks /Delete /TN "KupeCRM-Shutdown" /F >nul 2>&1
if %errorlevel% neq 0 echo    (ya no existia)

echo.
echo ===============================================================
echo   Tareas desinstaladas
echo ===============================================================
echo.
pause
