-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo.
--
-- PÁGINA METAS (aba Clientes):
--   Novo papel `metas_viewer` — quem pode VER a página Metas (visão de carteira do planejado).
--   A equipe Groohub (usuário interno) enxerga por padrão; o papel serve p/ LIBERAR a página a
--   um usuário-cliente, que por padrão fica SEM ela — a tela mostra a situação de TODOS os
--   clientes, então nenhum externo entra sem liberação explícita na Administração.
--   Mesma mecânica do `cronograma_viewer` (ver 20260828): a visibilidade é controlada no
--   frontend (AuthContext.canViewMetas = admin OU equipe OU metas_viewer; rota /clientes/metas
--   + aba + sidebar). As tabelas que a tela lê (clientes_meta, v_kommo_crm_agg, ads) já têm a
--   RLS delas, então isto controla a VISIBILIDADE da página, sem alterar leitura/escrita.

-- 1. Novo valor no enum de papéis. Idempotente. has_metas_access compara role::text, então o
--    novo valor não é usado como literal em statement da mesma transação (sem "unsafe use").
alter type public.app_role add value if not exists 'metas_viewer';

-- 2. Helper: pode ver a tela de Metas? = admin OU papel metas_viewer. SECURITY DEFINER p/ ler
--    user_roles sem depender da RLS do chamador (igual has_role/has_cronograma_access). Não é
--    usado por nenhuma policy hoje (visibilidade é no front), mas fica pronto p/ gating futuro.
create or replace function public.has_metas_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'metas_viewer'
      )
$$;

revoke execute on function public.has_metas_access(uuid) from public, anon;
grant execute on function public.has_metas_access(uuid) to authenticated;

notify pgrst, 'reload schema';
