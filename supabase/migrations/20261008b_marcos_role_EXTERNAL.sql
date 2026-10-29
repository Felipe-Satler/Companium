-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo (senão o toggle "Marcos" da
-- Administração falha ao inserir o papel — valor de enum inexistente).
--
-- PÁGINA "MARCOS" (2ª página da seção Gestão — metas mensais x realizado, rota /gestao/marcos):
--   Novo papel `marcos_viewer` — quem pode VER e ACESSAR a página Marcos. Permissão SEPARADA
--   da Gestão: por padrão SÓ o dono (Bruno, por e-mail) — nem admin, nem quem tem a Gestão
--   entram sozinhos. Liberada por ele na Administração (divisão "GESTÃO", botão "Marcos").
--   A visibilidade é 100% frontend (AuthContext.canViewMarcos = dono Bruno OU marcos_viewer;
--   MarcosRoute + AppSidebar). As metas ficam na tabela marcos_metas (RLS própria já criada);
--   este papel só controla o acesso à TELA.

-- 1. Novo valor no enum de papéis. Idempotente. O helper abaixo compara role::text, então o novo
--    valor não é usado como literal-enum em statement da mesma transação (evita "unsafe use").
alter type public.app_role add value if not exists 'marcos_viewer';

-- 2. Helper: pode ver a página Marcos? = admin OU papel marcos_viewer. SECURITY DEFINER p/ ler
--    user_roles sem depender da RLS do chamador (igual has_gestao_access). Não é usado por policy
--    hoje (o gate é no front), mas fica pronto p/ gating futuro.
create or replace function public.has_marcos_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'marcos_viewer'
      )
$$;

revoke execute on function public.has_marcos_access(uuid) from public, anon;
grant execute on function public.has_marcos_access(uuid) to authenticated;

notify pgrst, 'reload schema';
