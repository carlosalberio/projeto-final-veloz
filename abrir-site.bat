@echo off
setlocal
cd /d "%~dp0"

curl.exe --silent --fail --output NUL http://127.0.0.1:8001/ >NUL 2>&1
if errorlevel 1 start "VELOZ Local" python run.py

for /L %%i in (1,1,30) do (
  curl.exe --silent --fail --output NUL http://127.0.0.1:8001/ >NUL 2>&1
  if not errorlevel 1 goto open
  timeout /t 1 /nobreak >NUL
)

echo O site nao iniciou. Verifique a janela do Python e as dependencias.
pause
exit /b 1

:open
start "" "http://127.0.0.1:8001/"
