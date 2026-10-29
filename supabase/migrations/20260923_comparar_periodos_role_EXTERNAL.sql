-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo (senão o toggle da Administração falha
-- ao inserir o papel — valor de enum inexistente).
--
-- BOTÃO "COMPARAR PERÍODOS" (telas de Clientes: CRM / Meta Ads / Google Ads):
--   Novo papel `comparar_periodos_viewer` — quem pode usar o botão "Comparar períodos". NÃO é
--   liberado por padrão a ninguém (nem à equipe Groohub): só admin (implícito) OU quem for
--   MARCADO na Administração. A visibilidade é 100% frontend (AuthContext.canCompararPeriodos =
--   admin OU comparar_periodos_viewer; o botão e o painel de comparação nas 3 telas). Não altera
--   leitura/escrita de nenhuma tabela — a comparação é estado local da tela.

-- 1. Novo valor no enum de papéis. Idempotente. O helper abaixo compara role::text, então o novo
--    valor não é usado como literal-enum em statement da mesma transação (evita "unsafe use").
alter type public.app_role add value if not exists 'comparar_periodos_viewer';

-- 2. Helper: pode comparar períodos? = admin OU papel comparar_periodos_viewer. SECURITY DEFINER
--    p/ ler user_roles sem depender da RLS do chamador (igual has_role/has_cronograma_access).
--    Não é usado por policy hoje (o gate é no front), mas fica pronto p/ gating futuro.
create or replace function public.has_comparar_periodos_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'comparar_periodos_viewer'
      )
$$;

revoke execute on function public.has_comparar_periodos_access(uuid) from public, anon;
grant execute on function public.has_comparar_periodos_access(uuid) to authenticated;

notify pgrst, 'reload schema';
