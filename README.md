# EARTIFY — Space Explorer & Cero Research Assistant

EARTIFY keeps its existing browser-based 3D explorer and adds a server-side Cero assistant, private account libraries, document Q&A, hybrid retrieval, and scientific-literature discovery.

## Start locally

1. Install **Node.js 18+** (Node 20 or 22 recommended).
2. Install PDF/OCR system tools:
   - **Windows:** install Poppler for Windows (make `pdftotext.exe` and `pdftoppm.exe` available on `PATH`) and Tesseract OCR with English and Arabic language packs. Install Python 3 for DOCX parsing.
   - **macOS:** `brew install poppler tesseract tesseract-lang python`.
   - **Ubuntu/Debian:** `sudo apt install poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-ara python3`.
3. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` to enable full conversational AI and semantic retrieval. Keep the key private on the server.
4. On Windows, double-click `START-EARTIFY.bat`. On macOS/Linux, run `./START-EARTIFY.sh`. Or run `npm start`.
5. Open `http://localhost:3000`.

Without `OPENAI_API_KEY`, the site and basic/offline guided responses remain available, but Cero is not a full general-purpose AI. Semantic embeddings are only used when the key is configured; embedding requests may incur API usage charges.

## Current capabilities

### Cero
- Understands Arabic script, common Egyptian Arabizi, English, and mixed-language context using lightweight language/intent hints plus the configured language model.
- Uses conversation history for follow-ups and pronouns. Signed-in users have up to 80 recent messages stored per account.
- Has a step-by-step teaching policy for maths, physics, science, and general explanations; it adapts when a learner is confused and respects requests for hints or direct solutions.
- General conversation is not restricted to space topics.

### Research and scientific discovery
- Research Library search aggregates discovery results from NASA NTRS, Crossref, and arXiv when those providers respond.
- Cero research turns can retrieve records from the same three providers. Results are treated as discovery leads, not proof that a full paper was independently verified.
- Existing NASA imagery and planetary lookup features are preserved.
- `research-core.js` splits documents into overlapping passages and provides lexical ranking.
- `embedding-core.js` adds optional OpenAI embedding similarity blended with lexical relevance. If embeddings fail or are not configured, retrieval safely falls back to lexical search.

### Document library
- Upload and search TXT, MD, CSV, JSON, XML, HTML, PDF, and DOCX files (8 MB upload cap; extracted text capped at 300,000 characters).
- Text-based PDFs are extracted with Poppler. Scanned PDFs attempt OCR on the first 10 pages using Tesseract English + Arabic language packs.
- DOCX text is extracted from the document XML using Python's standard library; no pip packages are required.
- Saved documents are scoped to the signed-in account. Ask questions across the library or request a summary; the AI is instructed to answer from retrieved passages and identify the filename/passage.

### Security and reliability improvements
- Passwords are stored as salted scrypt hashes; session cookies are HttpOnly and SameSite=Strict.
- Basic per-route in-memory rate limiting and same-origin checks for POST requests.
- Public URL imports validate DNS results, block private/local IP ranges, validate redirects, and limit response size.
- API secrets remain server-side. Responses include basic security headers.

## Configuration

`.env` options:

- `OPENAI_API_KEY` — required for open-ended AI conversation and embeddings.
- `OPENAI_MODEL` — chat model; defaults to `gpt-4o-mini`.
- `OPENAI_EMBEDDING_MODEL` — defaults to `text-embedding-3-small`.
- `NASA_API_KEY` — retained as a configuration placeholder for NASA APIs that require a key; current NTRS search is public and does not use it.
- `PORT` — defaults to `3000`.

Never put secrets in `public/`, commit `.env`, or share your API key in screenshots or chat.

## API routes

- `GET /api/health` — reports feature configuration and supported document formats.
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/history`.
- `GET /api/documents`, `POST /api/documents`, `DELETE /api/documents/:id`, `POST /api/documents/ask`.
- `POST /api/robot-chat`, `POST /api/solve`, `POST /api/place-search`, `POST /api/compare-text`.
- `GET /api/research/search?q=...` — NASA NTRS + Crossref + arXiv discovery.
- `GET /api/research/ntrs?q=...` — NASA NTRS only.
- `GET /api/nasa-images?q=...`.

## Test and validate

```bash
npm test
npm run validate:datasets
node --check server.js
node --check public/app.js
```

The tests cover intent/language hints, chunking/retrieval, document extraction helpers, cosine similarity, and the no-key retrieval fallback. A local smoke test should also be performed after setup by opening the site and checking `/api/health`.

## Important limitations before public deployment

This is a strengthened local/student prototype, **not a production-hardened public service**. Before exposing it to the internet, replace the JSON-file database and demo account cap with a managed database, implement password reset/email verification and session expiry/revocation, use HTTPS and secure cookie configuration behind a correctly configured proxy, add durable distributed rate limiting, add backups and retention/deletion controls, review privacy/legal requirements, and perform a security audit. The current local JSON database is not designed for concurrent multi-instance hosting.

The search APIs are external dependencies and can be rate-limited or change their response formats. Search results must be opened and checked before being cited as evidence. Crossref does not necessarily provide abstracts; arXiv and NASA records may contain metadata/abstracts rather than full text. Full paper retrieval, source-to-source contradiction analysis, OCR beyond the first 10 PDF pages, and a trained intent model are not included. No model fine-tuning has been performed. EARTIFY's 3D planets are educational visualizations, not validated scientific digital twins.
