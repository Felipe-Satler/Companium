-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto DEPOIS de 20261026_uso_companium e 20261026b_uso_agentes. Aplicar ANTES de subir o
-- frontend novo (senão o popup de aviso não consegue gravar o "Entendi" e reaparece sempre).
--
-- PRIVACIDADE DA COLETA DE USO (aviso + página /privacidade):
--   * usage_notice_acks: quem viu o aviso de coleta, de qual versão e quando (prova de que a
--     pessoa foi informada; também evita reabrir o popup em outro computador).
--   * usage_optout: usuários que pediram para não ser medidos (direito de oposição, LGPD art. 18
--     §2º). Marcado pelo admin na Administração. O usage_track passa a ignorar quem está aqui.
--   * usage_data_requests: pedidos feitos pelo formulário da página /privacidade (cópia dos dados,
--     dúvida, oposição). A pessoa vê os próprios; o admin vê e resolve todos.

-- 1. Aviso visto.
create table if not exists public.usage_notice_acks (
  user_id  uuid not null references auth.users(id) on delete cascade default auth.uid(),
  version  integer not null,
  acked_at timestamptz not null default now(),
  primary key (user_id, version)
);
alter table public.usage_notice_acks enable row level security;

drop policy if exists usage_notice_acks_select on public.usage_notice_acks;
create policy usage_notice_acks_select on public.usage_notice_acks
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists usage_notice_acks_insert on public.usage_notice_acks;
create policy usage_notice_acks_insert on public.usage_notice_acks
  for insert to authenticated
  with check (user_id = auth.uid());

grant select, insert on public.usage_notice_acks to authenticated;

-- 2. Não medir este usuário.
create table if not exists public.usage_optout (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.usage_optout enable row level security;

drop policy if exists usage_optout_select on public.usage_optout;
create policy usage_optout_select on public.usage_optout
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists usage_optout_admin_insert on public.usage_optout;
create policy usage_optout_admin_insert on public.usage_optout
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists usage_optout_admin_delete on public.usage_optout;
create policy usage_optout_admin_delete on public.usage_optout
  for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select, insert, delete on public.usage_optout to authenticated;

-- 3. Pedidos sobre os dados de uso.
create table if not exists public.usage_data_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  tipo        text not null check (tipo in ('copia', 'duvida', 'oposicao', 'outro')),
  mensagem    text not null check (char_length(mensagem) between 1 and 2000),
  status      text not null default 'aberto' check (status in ('aberto', 'resolvido')),
  resposta    text check (resposta is null or char_length(resposta) <= 2000),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists ix_usage_data_requests_status on public.usage_data_requests (status, created_at desc);
alter table public.usage_data_requests enable row level security;

drop policy if exists usage_data_requests_select on public.usage_data_requests;
create policy usage_data_requests_select on public.usage_data_requests
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Quem pede só cria pedido aberto, em nome próprio.
drop policy if exists usage_data_requests_insert on public.usage_data_requests;
create policy usage_data_requests_insert on public.usage_data_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'aberto' and resposta is null and resolved_at is null and resolved_by is null);

drop policy if exists usage_data_requests_admin_update on public.usage_data_requests;
create policy usage_data_requests_admin_update on public.usage_data_requests
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

grant select, insert, update on public.usage_data_requests to authenticated;

-- 4. usage_track respeita o opt-out. A função atual (4 argumentos, da 20261026b) vira
--    usage_track_registrar (só chamada daqui) e o usage_track novo confere antes de gravar.
--    Idempotente: se já foi renomeada, só recria o usage_track.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'usage_track_registrar') then
    alter function public.usage_track(uuid, jsonb, jsonb, jsonb) rename to usage_track_registrar;
  end if;
end $$;

revoke execute on function public.usage_track_registrar(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.usage_track(
  p_session uuid,
  p_visits jsonb default '[]'::jsonb,
  p_clicks jsonb default '[]'::jsonb,
  p_agents jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.usage_optout where user_id = auth.uid()) then return; end if;
  perform public.usage_track_registrar(p_session, p_visits, p_clicks, p_agents);
end;
$$;

revoke execute on function public.usage_track(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.usage_track(uuid, jsonb, jsonb, jsonb) to authenticated;

-- 5. Perguntas/respostas dos agentes vêm das conversas salvas (não passam pelo usage_track):
--    quem está no opt-out também sai dessa contagem daqui em diante. Igual à 20261026b + 1 filtro.
create or replace function public.usage_agent_msgs(p_from date, p_to date)
returns table (dia date, user_id uuid, bot_id text, perguntas bigint, respostas bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.dia, m.user_id, m.bot_id,
         count(*) filter (where m.role = 'user') as perguntas,
         count(*) filter (where m.role = 'assistant') as respostas
  from (
    select (to_timestamp((e->>'timestamp')::double precision / 1000) at time zone 'America/Sao_Paulo')::date as dia,
           c.user_id, c.bot_id::text as bot_id, e->>'role' as role
    from public.chatbot_transcripts t
    join public.chatbot_conversations c on c.id = t.conversation_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(t.messages::jsonb) = 'array' then t.messages::jsonb else '[]'::jsonb end
    ) e
    where t.updated_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
      and exists (select 1 from auth.users u where u.id = c.user_id)  -- conversa de usuário apagado fica fora
      and not exists (select 1 from public.usage_optout o where o.user_id = c.user_id)
      and (e->>'timestamp') ~ '^[0-9]+(\.[0-9]+)?$'
      and (
        e->>'role' = 'user'
        or (e->>'role' = 'assistant' and coalesce(e->>'status', 'sent') <> 'failed' and coalesce(e->>'content', '') <> '')
      )
  ) m
  where m.dia between p_from and p_to
  group by m.dia, m.user_id, m.bot_id
$$;

revoke execute on function public.usage_agent_msgs(date, date) from public, anon, authenticated;

notify pgrst, 'reload schema';
