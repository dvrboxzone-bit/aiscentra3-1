-- ============================================================
-- AIscentra Migration 009
-- Admin Users Table and Auth Policies
-- Reference: Readiness Assessment v1.0 Blocker B-02
-- ============================================================

-- Admin sessions table — tracks which authenticated users are admins
-- Authentication: Supabase Auth (magic link)
-- Authorization: email must match ADMIN_EMAIL env var
--
-- Design: admin access is email-based, checked at the application layer.
-- The admin_users table is the authoritative list of admin emails.
-- Service role bypasses RLS for pipeline operations.

create table public.admin_users (
  id         uuid primary key default uuid_generate_v4(),
  email      text not null unique,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.admin_users enable row level security;

-- Admin users can only read their own record
create policy "Admin users can read own record"
  on public.admin_users
  for select
  to authenticated
  using (email = auth.jwt() ->> 'email');

-- ── Helper function: is current user an admin? ────────────────
-- Used in application-layer auth checks
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.admin_users
    where email = auth.jwt() ->> 'email'
  );
$$;

-- ── Seed: insert the admin email ─────────────────────────────
-- This is the email from ADMIN_EMAIL env var
-- In production: replace 'admin@aiscentra.com' with actual admin email
-- or run: insert into admin_users (email) values ('your@email.com');
insert into public.admin_users (email)
values ('admin@aiscentra.com')
on conflict (email) do nothing;

comment on table public.admin_users is
  'Authoritative admin email registry. '
  'Resolves Readiness Assessment Blocker B-02 (admin authentication). '
  'Auth mechanism: Supabase magic link. '
  'Authorization: email in this table.';

comment on function public.is_admin is
  'Returns true if the current authenticated user is in admin_users. '
  'Used in RLS policies and application-layer admin checks.';
