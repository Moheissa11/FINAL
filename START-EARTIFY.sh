#!/usr/bin/env bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Install it from https://nodejs.org/"
  exit 1
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add OPENAI_API_KEY to enable full Cero AI."
fi
for tool in pdftotext pdftoppm tesseract python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then echo "NOTE: $tool is missing; some document import features will be unavailable."; fi
done
echo "Starting EARTIFY..."
node server.js
