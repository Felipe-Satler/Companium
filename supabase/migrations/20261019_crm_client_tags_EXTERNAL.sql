-- PROJETO-ALVO: your-project-ref (companium / externalSupabase)
-- Rodar A MAO no SQL Editor desse projeto, A MIGRATION INTEIRA DE UMA VEZ.
-- Feature: tags/etiquetas de cliente no CRM.
--   crm_client_tags            = catalogo (nome + cor), reutilizavel
--   crm_client_tag_assignments = vinculo cliente <-> tag (N:N)
-- Depende de funcoes ja existentes: client_matchkey(text), has_crm_access(uuid), scope_kommo_ok(text).

-- 1) Catalogo de tags (global)
create table if not exists public.crm_client_tags (id uuid primary key default gen_random_uuid(), nome text not null, slug text not null unique, cor text not null default '#1A73E9', created_by uuid default auth.uid(), created_at timestamptz not null default now());
alter table public.crm_client_tags enable row level security;
drop policy if exists crm_client_tags_read on public.crm_client_tags;
create policy crm_client_tags_read on public.crm_client_tags for select to authenticated using (true);
drop policy if exists crm_client_tags_insert on public.crm_client_tags;
create policy crm_client_tags_insert on public.crm_client_tags for insert to authenticated with check (public.has_crm_access(auth.uid()));
drop policy if exists crm_client_tags_update on public.crm_client_tags;
create policy crm_client_tags_update on public.crm_client_tags for update to authenticated using (public.has_crm_access(auth.uid())) with check (public.has_crm_access(auth.uid()));
drop policy if exists crm_client_tags_delete on public.crm_client_tags;
create policy crm_client_tags_delete on public.crm_client_tags for delete to authenticated using (public.has_crm_access(auth.uid()));

-- 2) Atribuicoes cliente <-> tag
create table if not exists public.crm_client_tag_assignments (id uuid primary key default gen_random_uuid(), client_key text not null, client text not null, tag_id uuid not null references public.crm_client_tags(id) on delete cascade, created_by uuid default auth.uid(), created_at timestamptz not null default now(), unique (client_key, tag_id));
create index if not exists crm_client_tag_assignments_tag_idx on public.crm_client_tag_assignments (tag_id);
create index if not exists crm_client_tag_assignments_client_idx on public.crm_client_tag_assignments (client_key);
alter table public.crm_client_tag_assignments enable row level security;
drop policy if exists crm_client_tag_assignments_read on public.crm_client_tag_assignments;
create policy crm_client_tag_assignments_read on public.crm_client_tag_assignments for select to authenticated using (true);
drop policy if exists crm_client_tag_assignments_client_scope on public.crm_client_tag_assignments;
create policy crm_client_tag_assignments_client_scope on public.crm_client_tag_assignments as restrictive for select to authenticated using (public.scope_kommo_ok(client));
drop policy if exists crm_client_tag_assignments_insert on public.crm_client_tag_assignments;
create policy crm_client_tag_assignments_insert on public.crm_client_tag_assignments for insert to authenticated with check (public.has_crm_access(auth.uid()));
drop policy if exists crm_client_tag_assignments_update on public.crm_client_tag_assignments;
create policy crm_client_tag_assignments_update on public.crm_client_tag_assignments for update to authenticated using (public.has_crm_access(auth.uid())) with check (public.has_crm_access(auth.uid()));
drop policy if exists crm_client_tag_assignments_delete on public.crm_client_tag_assignments;
create policy crm_client_tag_assignments_delete on public.crm_client_tag_assignments for delete to authenticated using (public.has_crm_access(auth.uid()));

notify pgrst, 'reload schema';
