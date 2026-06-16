# E-Library

A simple full-stack digital library: browse books, read PDFs, and upload covers and files.

| Layer | Technology |
|-------|------------|
| Frontend | HTML, CSS, JavaScript (ES modules) |
| Hosting | Vercel (Frontend & API unified) |
| API | Vercel Serverless Functions (Node.js) |
| Database | TiDB Cloud (MySQL-compatible) |
| Files | Cloudinary |

## Project structure

```
e-library/
├── frontend/          # Static UI
├── api/               # Vercel Serverless Functions
├── schema/init.sql    # TiDB table + optional seed
├── vercel.json        # Vercel routing configuration
└── package.json       # Root node packages & scripts
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Vercel CLI](https://vercel.com/docs/cli) (`npm install -g vercel`)
- [Cloudinary](https://cloudinary.com/) account
- [TiDB Cloud](https://tidbcloud.com/) cluster (free tier works)

## 1. Database (TiDB Cloud)

1. Create a TiDB Cloud cluster and database (e.g. `e_library`).
2. Open the SQL editor and run [`schema/init.sql`](schema/init.sql).
3. If you previously deployed an older schema with a `status` column, run [`schema/migrations/001_drop_status.sql`](schema/migrations/001_drop_status.sql).
4. Note **host**, **user**, **password**, and **database** name.

## 2. Cloudinary Setup

1. Sign up/log in to your Cloudinary Dashboard.
2. Note your **Cloud Name**, **API Key**, and **API Secret**.

## 3. Environment Variables Configuration

Copy [.env.example](.env.example) to `.env` and fill values:

```env
TIDB_HOST=your-tidb-host
TIDB_USER=your-tidb-user
TIDB_PASSWORD=your-tidb-password
TIDB_DATABASE=your-tidb-database
API_KEY=your-custom-admin-api-key
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
RATE_LIMIT_PER_MIN=120
```

Configure these same environment variables in your Vercel project dashboard under **Project Settings > Environment Variables**.

## 4. Installation & Local Development

Install dependencies at the root:

```bash
npm install
```

Start the custom local development server:

```bash
npm run dev
```

This will start a dev server (typically at `http://localhost:3000`) serving both the static frontend and the serverless functions under `/api/*`.

## API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Readiness check for DB and storage config |
| GET | `/api/books?q=&page=&limit=` | No | List/search books with pagination |
| GET | `/api/books/:id` | No | Get one book |
| POST | `/api/books` | Bearer | Create book (JSON) |
| PATCH | `/api/books/:id` | Bearer | Update metadata |
| DELETE | `/api/books/:id` | Bearer | Delete book + Cloudinary assets |
| POST | `/api/books/:id/cover` | Bearer | Upload cover (`multipart`, field `file`) |
| POST | `/api/books/:id/file` | Bearer | Upload PDF/file (`multipart`, field `file`) |
| GET | `/api/files/:key` | No | Redirect to Cloudinary file URL |

In production (`NODE_ENV=production`), write endpoints require `API_KEY`.

## Security notes

- Never commit database credentials or Cloudinary secrets. Keep them in Vercel dashboard and local `.env`.
- Use `API_KEY` in production and share it only with admins.
- Viewer download/print shortcut blocking is a UX guard only, not copy protection.
- `RATE_LIMIT_PER_MIN` enables best-effort per-instance rate limiting on list/file endpoints.

## License

MIT
