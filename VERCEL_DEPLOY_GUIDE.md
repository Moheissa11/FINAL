# EARTIFY — Vercel Hobby deployment

## What this package changes
- Exposes the existing Node HTTP request handler through `api/[...path].js` so Vercel can run the existing `/api/*` routes as a Function.
- Keeps the existing `public/` directory for static assets served by Vercel.
- Uses `/tmp/eartify-data` on Vercel because the deployment filesystem is not persistent.

## Important demo limitation
The current starter database is a JSON file. On Vercel it is stored in temporary function storage, so accounts, sessions, saved documents, and history are **not guaranteed to survive** a cold start, redeployment, or a different function instance. This is acceptable only for a short-lived demo. For reliable saved accounts/documents, connect a persistent database (for example, a free-tier hosted Postgres service) before treating the app as a real service.

## Deploy
1. Upload the contents of this folder to the root of the GitHub repository.
2. In Vercel, choose **Add New → Project**, import the GitHub repository, and keep the detected defaults.
3. In Project Settings → Environment Variables, add `OPENAI_API_KEY` if AI-powered responses are wanted. Optionally add:
   - `OPENAI_MODEL` = `gpt-4o-mini`
   - `OPENAI_EMBEDDING_MODEL` = `text-embedding-3-small`
4. Deploy. Then open `/api/health` on the deployed domain and confirm it returns `ok: true`.

No Render settings are required. Do not add a `DATA_DIR` value for this temporary demo configuration.
