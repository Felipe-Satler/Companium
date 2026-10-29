-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo (senão a aba Equipes da Administração e a
-- aba Equipes de /uso dão erro).
--
-- EQUIPES (cadastro na Administração + comparação de uso em /uso):
--   * equipes: o cadastro. "Excluir" só apaga equipe que nunca teve membro; com histórico ela é
--     ARQUIVADA (some da atribuição, mas continua nas comparações de períodos passados).
--   * equipe_membros: histórico de pertencimento [inicio, fim). Uma equipe por pessoa por vez
--     (índice único com fim nulo). Só equipe interna: usuário-cliente não entra (checado na RPC).
--     A PRIMEIRA atribuição de alguém começa em -infinity (o uso anterior também conta para ela);
--     trocas seguintes valem a partir do momento da troca.
--   * Regra do dia (usada no frontend): a pessoa está na equipe no dia d se
--     inicio_dia <= d < fim_dia (dias em America/Sao_Paulo). No dia de uma troca vale a equipe nova.

-- 1. Tabelas.
create table if not exists public.equipes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(btrim(nome)) between 1 and 60),
  arquivada_em timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create unique index if not exists ux_equipes_nome on public.equipes (lower(btrim(nome)));

create table if not exists public.equipe_membros (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  equipe_id  uuid not null references public.equipes(id) on delete restrict,
  inicio     timestamptz not null,
  fim        timestamptz,
  created_by uuid default auth.uid(),
  check (fim is null or fim > inicio)
);
create unique index if not exists ux_equipe_membros_aberto on public.equipe_membros (user_id) where fim is null;
create index if not exists ix_equipe_membros_equipe on public.equipe_membros (equipe_id);

alter table public.equipes enable row level security;
alter table public.equipe_membros enable row level security;

-- Leitura: admin e quem vê a página /uso. Escrita do cadastro: admin. Pertencimento só pelas RPCs.
drop policy if exists equipes_select on public.equipes;
create policy equipes_select on public.equipes
  for select to authenticated
  using (public.has_usage_access(auth.uid()));

drop policy if exists equipes_admin_insert on public.equipes;
create policy equipes_admin_insert on public.equipes
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists equipes_admin_update on public.equipes;
create policy equipes_admin_update on public.equipes
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists equipes_admin_delete on public.equipes;
create policy equipes_admin_delete on public.equipes
  for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists equipe_membros_select on public.equipe_membros;
create policy equipe_membros_select on public.equipe_membros
  for select to authenticated
  using (public.has_usage_access(auth.uid()));

grant select, insert, update, delete on public.equipes to authenticated;
grant select on public.equipe_membros to authenticated;

-- 2. Atribuir (ou tirar, com p_equipe nulo) a equipe de um usuário. Fecha o pertencimento aberto
--    e abre o novo. Primeira atribuição da pessoa começa em -infinity.
create or replace function public.equipe_atribuir(p_user uuid, p_equipe uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _atual uuid;
  _agora timestamptz := now();
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Acesso negado'; end if;
  if p_equipe is not null then
    if exists (select 1 from public.user_client_scope where user_id = p_user) then
      raise exception 'Usuário-cliente não entra em equipe';
    end if;
    if not exists (select 1 from public.equipes where id = p_equipe and arquivada_em is null) then
      raise exception 'Equipe inexistente ou arquivada';
    end if;
  end if;

  select equipe_id into _atual from public.equipe_membros where user_id = p_user and fim is null;
  if _atual is not distinct from p_equipe then return; end if;

  update public.equipe_membros set fim = _agora where user_id = p_user and fim is null;

  if p_equipe is not null then
    insert into public.equipe_membros (user_id, equipe_id, inicio)
    values (
      p_user, p_equipe,
      case when exists (select 1 from public.equipe_membros where user_id = p_user) then _agora
           else '-infinity'::timestamptz end
    );
  end if;
end;
$$;

revoke execute on function public.equipe_atribuir(uuid, uuid) from public, anon;
grant execute on function public.equipe_atribuir(uuid, uuid) to authenticated;

-- 3. Arquivar: tira todo mundo da equipe (fecha os pertencimentos) e esconde da atribuição.
create or replace function public.equipe_arquivar(p_equipe uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Acesso negado'; end if;
  update public.equipe_membros set fim = now() where equipe_id = p_equipe and fim is null;
  update public.equipes set arquivada_em = now() where id = p_equipe and arquivada_em is null;
end;
$$;

revoke execute on function public.equipe_arquivar(uuid) from public, anon;
grant execute on function public.equipe_arquivar(uuid) to authenticated;

-- 4. Leitura para a comparação em /uso: equipes + pertencimentos com os dias já em SP.
--    inicio_dia nulo = desde sempre; fim_dia nulo = ainda na equipe.
create or replace function public.usage_equipes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_usage_access(auth.uid()) then raise exception 'Acesso negado'; end if;
  return jsonb_build_object(
    'equipes', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'arquivada', e.arquivada_em is not null) order by e.nome)
      from public.equipes e
    ), '[]'::jsonb),
    'membros', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'equipe_id', m.equipe_id,
               'inicio_dia', case when m.inicio = '-infinity'::timestamptz then null
                                  else (m.inicio at time zone 'America/Sao_Paulo')::date end,
               'fim_dia', case when m.fim is null then null
                               else (m.fim at time zone 'America/Sao_Paulo')::date end))
      from public.equipe_membros m
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.usage_equipes() from public, anon;
grant execute on function public.usage_equipes() to authenticated;

notify pgrst, 'reload schema';
