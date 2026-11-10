@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example. Add your OPENAI_API_KEY to enable full Cero AI.
)
where pdftotext >nul 2>nul
if errorlevel 1 echo NOTE: Poppler is missing from PATH. PDF text extraction will not work until installed.
where pdftoppm >nul 2>nul
if errorlevel 1 echo NOTE: pdftoppm is missing. Scanned PDF OCR will not work until Poppler is installed.
where tesseract >nul 2>nul
if errorlevel 1 echo NOTE: Tesseract is missing. Scanned PDF OCR will not work until installed.
where python >nul 2>nul
if errorlevel 1 echo NOTE: Python 3 is missing. DOCX extraction will not work until installed.
echo Starting EARTIFY...
node server.js
pause
