-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo.
--
-- PÁGINA CRONOGRAMA (aba Clientes):
--   Novo papel `cronograma_viewer` — quem pode VER a página Cronograma. A equipe Groohub
--   (usuário interno) enxerga por padrão; o papel serve p/ LIBERAR a página a um usuário-cliente,
--   que por padrão fica sem ela. A visibilidade é controlada no frontend (AuthContext.
--   canViewCronograma = admin OU equipe OU cronograma_viewer; rota /clientes/cronograma +
--   sidebar). As tabelas projetos_cronograma_* já são legíveis por authenticated, então isto
--   controla a VISIBILIDADE da página, sem alterar a leitura/escrita das tabelas (escrita segue
--   restrita à equipe — ver 20260827c). Usuário-cliente entra somente-leitura (canEdit no front).

-- 1. Novo valor no enum de papéis. Idempotente. has_cronograma_access compara role::text, então
--    o novo valor não é usado como literal em statement da mesma transação (sem "unsafe use").
alter type public.app_role add value if not exists 'cronograma_viewer';

-- 2. Helper: pode ver o Cronograma? = admin OU papel cronograma_viewer. SECURITY DEFINER p/ ler
--    user_roles sem depender da RLS do chamador (igual has_role/has_captacao_access). Não é usado
--    por nenhuma policy hoje (visibilidade é no front), mas fica pronto p/ gating futuro.
create or replace function public.has_cronograma_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'cronograma_viewer'
      )
$$;

revoke execute on function public.has_cronograma_access(uuid) from public, anon;
grant execute on function public.has_cronograma_access(uuid) to authenticated;

notify pgrst, 'reload schema';
