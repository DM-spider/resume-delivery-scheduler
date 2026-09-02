@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    echo Project virtual environment not found: %PYTHON_EXE%
    echo Create it first: py -3 -m venv .venv
    echo Then install dependencies: .venv\Scripts\python.exe -m pip install -r requirements.txt
    pause
    exit /b 1
)

"%PYTHON_EXE%" -c "import fastapi, uvicorn, pydantic" >nul 2>nul
if errorlevel 1 (
    echo Project virtual environment is missing dependencies.
    echo Run: .venv\Scripts\python.exe -m pip install -r requirements.txt
    pause
    exit /b 1
)

echo Starting JobApplyScheduler backend with %PYTHON_EXE%...
"%PYTHON_EXE%" main.py
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Backend exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
