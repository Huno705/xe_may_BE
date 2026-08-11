# Showroom Backend

Node.js + Express API for the motorcycle showroom, using Supabase for data and image storage.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a Supabase project at https://supabase.com

3. In the Supabase SQL editor, run the schema in [`supabase/schema.sql`](supabase/schema.sql).

4. Create a Storage bucket named `motorcycle-images` and make it **public**
   (Storage → New bucket → check "Public bucket").

5. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL` — Project Settings → API → Project URL
   - `SUPABASE_SERVICE_KEY` — Project Settings → API → `service_role` key (keep secret)
   - `JWT_SECRET` — any long random string
   - `PORT` — defaults to 5000

6. Create an admin account:
   ```bash
   npm run create-admin admin@example.com yourpassword
   ```

7. Start the server:
   ```bash
   npm run dev
   ```

## API

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | — | Admin login, returns JWT |
| GET | `/api/auth/verify` | — | Verify a JWT |
| GET | `/api/motorcycles` | — | List all motorcycles |
| GET | `/api/motorcycles/:id` | — | Get one motorcycle |
| POST | `/api/motorcycles` | admin | Create (multipart: `name`, `price`, `description`, `images[]`) |
| PUT | `/api/motorcycles/:id` | admin | Update (multipart, `existingImages` JSON array to keep) |
| DELETE | `/api/motorcycles/:id` | admin | Delete |
