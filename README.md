# E-Library

A simple full-stack digital library: browse books, borrow/return, upload covers and PDFs.

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
3. Note **host**, **user**, **password**, and **database** name.

## 2. Cloudinary Setup

1. Sign up/log in to your Cloudinary Dashboard.
2. Note your **Cloud Name**, **API Key**, and **API Secret**.

## 3. Environment Variables Configuration

Copy environment variables template (or create a `.env` file at the root) for local development:

```env
TIDB_HOST=your-tidb-host
TIDB_USER=your-tidb-user
TIDB_PASSWORD=your-tidb-password
TIDB_DATABASE=your-tidb-database
API_KEY=your-custom-admin-api-key
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
```

Configure these same environment variables in your Vercel project dashboard under **Project Settings > Environment Variables**.

## 4. Installation & Local Development

Install dependencies at the root:

```bash
npm install
```

Start the Vercel local development server:

```bash
npm run dev
```

This will start a dev server (typically at `http://localhost:3000`) serving both the static frontend and the serverless functions under `/api/*`.

## API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/books?q=` | No | List/search books |
| GET | `/api/books/:id` | No | Get one book |
| POST | `/api/books` | Bearer | Create book (JSON) |
| PATCH | `/api/books/:id` | Bearer | Update metadata/status |
| DELETE | `/api/books/:id` | Bearer | Delete book + Cloudinary assets |
| POST | `/api/books/:id/cover` | Bearer | Upload cover (`multipart`, field `file`) |
| POST | `/api/books/:id/file` | Bearer | Upload PDF/file (`multipart`, field `file`) |
| GET | `/api/files/:key` | No | Redirect to the Cloudinary URL |

If `API_KEY` is not set on the Vercel deployment, write endpoints are open.

## Security notes

- Never commit database credentials or Cloudinary secrets. Keep them in Vercel dashboard and local `.env`.
- Use `API_KEY` in production and share it only with admins.

## License

MIT
