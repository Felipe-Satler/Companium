-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo (senão o toggle da Administração falha
-- ao inserir o papel — valor de enum inexistente).
--
-- SEÇÃO "GESTÃO" (visão interna da carteira / RevOps — página e aba Gestão):
--   Novo papel `gestao_viewer` — quem pode VER e ACESSAR a seção Gestão (aba na sidebar +
--   rota /gestao/gestao). NÃO é liberado por padrão a ninguém (nem à equipe Groohub): só admin
--   (implícito) OU quem for MARCADO na Administração (divisão "GESTÃO", botão "Gestão").
--   A visibilidade é 100% frontend (AuthContext.canViewGestao = admin OU gestao_viewer;
--   GestaoRoute + AppSidebar). Os dados da Gestão vêm do proxy da planilha (não de tabela do
--   banco), então não há RLS de dados a alterar — este papel só controla o acesso à tela.

-- 1. Novo valor no enum de papéis. Idempotente. O helper abaixo compara role::text, então o novo
--    valor não é usado como literal-enum em statement da mesma transação (evita "unsafe use").
alter type public.app_role add value if not exists 'gestao_viewer';

-- 2. Helper: pode ver a Gestão? = admin OU papel gestao_viewer. SECURITY DEFINER p/ ler
--    user_roles sem depender da RLS do chamador (igual has_role/has_comparar_periodos_access).
--    Não é usado por policy hoje (o gate é no front), mas fica pronto p/ gating futuro.
create or replace function public.has_gestao_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'gestao_viewer'
      )
$$;

revoke execute on function public.has_gestao_access(uuid) from public, anon;
grant execute on function public.has_gestao_access(uuid) to authenticated;

notify pgrst, 'reload schema';
