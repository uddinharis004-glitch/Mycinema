@echo off
cd /d "%~dp0"
if not exist ".env.processor" (
  echo Missing .env.processor
  echo Copy .env.processor.example to .env.processor and add your R2 values first.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing CineVault dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
call npm run processor
pause
