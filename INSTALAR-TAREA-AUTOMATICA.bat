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
    echo   INSTALAR-TAREA-AUTOMATICA.bat y elegi
    echo   "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

color 0A
set PROJECT_DIR=%~dp0
set BAT_PATH=%PROJECT_DIR%EJECUTAR-ACTUALIZAR-CRM.bat

echo.
echo ===============================================================
echo   Kupe CRM - Instalacion de tareas automaticas
echo ===============================================================
echo.
echo Proyecto: %PROJECT_DIR%
echo.

echo [1/3] Creando tarea diaria 00:15 ...
schtasks /Create /TN "KupeCRM-Daily" /TR "\"%BAT_PATH%\"" /SC DAILY /ST 00:15 /RL HIGHEST /F >nul
if %errorlevel% neq 0 goto :error

echo [2/3] Creando tarea al iniciar sesion ...
schtasks /Create /TN "KupeCRM-Logon" /TR "\"%BAT_PATH%\"" /SC ONLOGON /RL HIGHEST /F >nul
if %errorlevel% neq 0 goto :error

echo [3/3] Creando tarea de apagado 01:00 ...
schtasks /Create /TN "KupeCRM-Shutdown" /TR "shutdown /s /f /t 30 /c \"Apagado automatico programado\"" /SC DAILY /ST 01:00 /RL HIGHEST /F >nul
if %errorlevel% neq 0 goto :error

echo.
echo Configurando "Ejecutar lo antes posible si se omitio un inicio"...
powershell -NoProfile -Command "$t = Get-ScheduledTask -TaskName 'KupeCRM-Daily'; $t.Settings.StartWhenAvailable = $true; Set-ScheduledTask -InputObject $t | Out-Null" >nul 2>&1
powershell -NoProfile -Command "$t = Get-ScheduledTask -TaskName 'KupeCRM-Logon'; $t.Settings.StartWhenAvailable = $true; Set-ScheduledTask -InputObject $t | Out-Null" >nul 2>&1

echo.
echo ===============================================================
echo   Instalacion completada con exito
echo ===============================================================
echo.
echo Tareas registradas:
echo   - KupeCRM-Daily     -^> ejecuta CRM diario a las 00:15
echo   - KupeCRM-Logon     -^> ejecuta CRM al iniciar sesion
echo   - KupeCRM-Shutdown  -^> apaga la PC a las 01:00
echo.
echo Para verlas: Inicio -^> "Programador de tareas" -^> Biblioteca
echo Para sacarlas: doble click en DESINSTALAR-TAREA-AUTOMATICA.bat
echo.
pause
exit /b 0

:error
color 0C
echo.
echo ERROR: Fallo la creacion de una tarea. Revisa el mensaje arriba.
echo.
pause
exit /b 1
