# E-Library

A simple full-stack digital library: browse books, borrow/return, upload covers and PDFs.

| Layer | Technology |
|-------|------------|
| Frontend | HTML, CSS, JavaScript (ES modules) |
| Hosting | GitHub Pages (`frontend/`) |
| API | Cloudflare Workers |
| Database | TiDB Cloud (MySQL-compatible) |
| Files | Cloudflare R2 |

## Project structure

```
e-library/
├── frontend/          # Static UI (GitHub Pages)
├── worker/            # Cloudflare Worker API
├── schema/init.sql    # TiDB table + optional seed
└── .github/workflows/ # Pages deploy on push to main
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare](https://dash.cloudflare.com/) account (Workers + R2)
- [TiDB Cloud](https://tidbcloud.com/) cluster (free tier works)
- GitHub repo for Pages (optional Actions workflow included)

## 1. Database (TiDB Cloud)

1. Create a TiDB Cloud cluster and database (e.g. `e_library`).
2. Open the SQL editor and run [`schema/init.sql`](schema/init.sql).
3. Note **host**, **user**, **password**, and **database** name.

## 2. R2 bucket

```bash
cd worker
npx wrangler r2 bucket create e-library-files
```

The bucket name must match `bucket_name` in [`worker/wrangler.toml`](worker/wrangler.toml).

## 3. Cloudflare Worker

```bash
cd worker
npm install
```

Copy secrets template and fill in values for local dev:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your TiDB credentials and an `API_KEY` for admin writes.

Set the same secrets in production:

```bash
npx wrangler secret put TIDB_HOST
npx wrangler secret put TIDB_USER
npx wrangler secret put TIDB_PASSWORD
npx wrangler secret put TIDB_DATABASE
npx wrangler secret put API_KEY
```

Update `CORS_ORIGIN` in [`worker/wrangler.toml`](worker/wrangler.toml) to your GitHub Pages URL, e.g.:

```toml
CORS_ORIGIN = "https://yourusername.github.io"
```

Deploy:

```bash
npm run deploy
```

Copy the Worker URL (e.g. `https://e-library-api.your-subdomain.workers.dev`).

## 4. Frontend config

Edit [`frontend/js/config.js`](frontend/js/config.js):

```javascript
export const API_BASE_URL = "https://e-library-api.your-subdomain.workers.dev";
```

## 5. GitHub Pages

**Option A — GitHub Actions (recommended)**

1. Repo → **Settings** → **Pages** → Source: **GitHub Actions**.
2. Push to `main`; the workflow deploys `frontend/`.

**Option B — Manual**

Settings → Pages → Deploy from branch → folder `/frontend`.

After deploy, set Worker `CORS_ORIGIN` to your Pages URL if you have not already.

## Local development

**API**

```bash
cd worker
npm run dev
```

Uses `.dev.vars` for TiDB and `API_KEY`. R2 uses the remote bucket binding in dev.

**Frontend**

```bash
npx serve frontend
```

Set `API_BASE_URL` in `frontend/js/config.js` to `http://127.0.0.1:8787` and `CORS_ORIGIN` in `wrangler.toml` to `http://localhost:3000` (or your serve port).

Open the site, enter the same `API_KEY` in the admin field, then add/borrow/delete books.

## API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/books?q=` | No | List/search books |
| GET | `/api/books/:id` | No | Get one book |
| POST | `/api/books` | Bearer | Create book (JSON) |
| PATCH | `/api/books/:id` | Bearer | Update metadata/status |
| DELETE | `/api/books/:id` | Bearer | Delete book + R2 objects |
| POST | `/api/books/:id/cover` | Bearer | Upload cover (`multipart`, field `file`) |
| POST | `/api/books/:id/file` | Bearer | Upload PDF (`multipart`, field `file`) |
| GET | `/api/files/:key` | No | Download/stream R2 object |

If `API_KEY` is not set on the Worker, write endpoints are open (not recommended for production).

## Security notes

- Never commit `.dev.vars` or production API keys.
- Use `API_KEY` in production and share it only with admins.
- TiDB credentials live only in Worker secrets, never in the frontend.

## License

MIT
