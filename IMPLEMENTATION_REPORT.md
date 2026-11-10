# EARTIFY — implementation report (advanced build)

## What was added in this build

1. **PDF and DOCX document ingestion**
   - Added `document-extract.js`.
   - Supports TXT, MD, CSV, JSON, XML, HTML, PDF, and DOCX.
   - Text PDFs use Poppler `pdftotext`; scanned PDFs attempt OCR for up to the first 10 pages using `pdftoppm` + Tesseract (`eng+ara`).
   - DOCX text is extracted from `word/document.xml` with Python's standard library.
   - Upload cap: 8 MB. Extracted-text cap: 300,000 characters.

2. **Hybrid retrieval / semantic search**
   - Added `embedding-core.js` with OpenAI embedding calls, cosine similarity, and a weighted blend of semantic similarity and lexical relevance.
   - Embeddings are enabled only when `OPENAI_API_KEY` is configured. When not configured or when the embeddings endpoint fails, retrieval falls back to lexical ranking.
   - A process-local cache avoids repeatedly embedding the same chunks during a running server process. It is not a persistent vector database.

3. **Scientific literature discovery**
   - Added combined discovery across NASA NTRS, Crossref, and arXiv.
   - Added `/api/research/search?q=...` and connected the Research Library search UI.
   - Cero research turns can include retrieved records from the same providers and are instructed to distinguish discovery records from independently verified full papers.

4. **Safer server behavior**
   - Added basic in-memory per-route rate limits and same-origin checks for POST requests.
   - Hardened public URL imports with DNS/IP checks, redirect revalidation, response-size limits, and timeout handling.
   - Added response security headers and stricter SameSite session cookies.
   - Added outbound AI request timeouts.

5. **Documentation and setup**
   - Updated `.env.example` with the embedding model setting.
   - Updated README with setup requirements, supported formats, API routes, test commands, and remaining deployment limitations.

## Preserved existing functionality

The existing EARTIFY 3D explorer, visual assets, account interface, research library, conversation UI, mission concept generator, NASA image search, and planet lookup flow remain in the project. No frontend framework migration was performed.

## Verification performed in this environment

- `npm test`: **13 passed, 0 failed**.
- `npm run validate:datasets`: **26 unique JSONL records** (16 train, 5 validation, 5 test).
- `node --check`: passed for server, frontend script, assistant core, research core, embedding core, and document extractor.
- Local HTTP smoke test: homepage HTTP 200; health endpoint returned `ok:true`; too-short research query correctly returned HTTP 400.
- End-to-end signed-in PDF upload test: account creation succeeded, PDF text extraction succeeded, and the saved document appeared in the account library.
- Direct extraction checks: text PDF, scanned PDF OCR, and DOCX extraction succeeded using the installed system tools.

## Not verified / external dependencies

- Live NASA NTRS, Crossref, and arXiv requests could not be confirmed from this execution environment; outbound network access may be restricted. Their integrations are implemented but must be tested from the user's machine/network.
- OpenAI chat and embedding calls were not tested because no user API key was supplied. Configure `OPENAI_API_KEY` locally. Embeddings may incur API usage charges.
- OCR requires Poppler and Tesseract with English and Arabic language packs installed on the host. PDF and DOCX extraction was tested in this Linux environment; Windows setup requires installing the documented binaries and adding them to PATH.

## Remaining limitations

- No persistent vector database. The semantic chunk cache is in-memory and resets when the server restarts; embeddings are recomputed as needed.
- Crossref results may not include abstracts; search results from all providers need source-level verification.
- Full-text publisher access, paper-to-paper contradiction analysis, OCR beyond 10 pages, and citation-quality evaluation are not implemented.
- Starter datasets are synthetic examples, not a trained intent classifier. No fine-tuning was performed.
- The JSON-file database and simple local authentication are still unsuitable for public multi-instance production. Before public launch, use a managed database, email verification/password reset, session expiry/revocation, HTTPS, durable distributed rate limiting, backups, privacy controls, and an independent security review.
- EARTIFY's 3D planetary models are educational visualizations, not validated scientific digital twins.

## Required user configuration

- Set `OPENAI_API_KEY` in a local `.env` file for full AI chat and semantic embeddings.
- Install Poppler, Tesseract (`eng` and `ara` language data), and Python 3 for document extraction.
- Do not share or commit `.env`.
