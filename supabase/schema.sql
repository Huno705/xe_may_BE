-- Run this in the Supabase SQL editor

-- Motorcycles table
create table if not exists motorcycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null,
  description text default '',
  images text[] default array[]::text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Admins table
create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password text not null,
  created_at timestamptz default now()
);

-- Auto-update updated_at on motorcycles
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_motorcycles_updated_at on motorcycles;
create trigger trg_motorcycles_updated_at
before update on motorcycles
for each row execute function set_updated_at();

-- Row Level Security
alter table motorcycles enable row level security;
alter table admins enable row level security;

-- The backend connects with the Supabase service role key, which bypasses RLS
-- entirely, so all writes (insert/update/delete) go through the API and its
-- own JWT admin check. The only policy needed here is public read access for
-- any client that queries Supabase directly with the anon key.
create policy "Public read motorcycles" on motorcycles
  for select using (true);

-- No policies are created for admins: it is never queried with the anon key,
-- only via the backend's service role key.
