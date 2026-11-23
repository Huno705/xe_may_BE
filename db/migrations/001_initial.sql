CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.motorcycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric NOT NULL,
  description text DEFAULT '',
  images text[] DEFAULT ARRAY[]::text[],
  saigon_deposit numeric DEFAULT 0,
  province_deposit numeric DEFAULT 0,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX motorcycles_created_at_idx ON public.motorcycles (created_at DESC, id);
CREATE INDEX motorcycles_branch_created_at_idx ON public.motorcycles (branch_id, created_at DESC);

CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_motorcycles_updated_at BEFORE UPDATE ON public.motorcycles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Express is the only database client. No Supabase roles, policies or auth/storage schemas.
REVOKE ALL ON public.admins, public.branches, public.motorcycles FROM PUBLIC;
