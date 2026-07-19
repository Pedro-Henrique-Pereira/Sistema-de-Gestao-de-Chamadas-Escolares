@echo off
cd /d %~dp0
if not exist ".venv\Scripts\python.exe" (
  echo Ambiente virtual ausente. Execute: python -m venv .venv
  exit /b 1
)
".venv\Scripts\python.exe" main.py
pause
