-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto DEPOIS de 20261026_uso_companium (usa as tabelas e funções dela).
--
-- USO DOS AGENTES DE IA (GrooChat) na página /uso, aba "Agentes de IA":
--   * Tempo ativo por agente: o frontend manda as "visitas de agente" (chat aberto e em uso,
--     na página /assistente ou no chat flutuante) junto no usage_track → usage_agent_visits.
--     Conta a partir do deploy; não há histórico de tempo antes disso.
--   * Perguntas feitas e textos recebidos: contados DIRETO das conversas salvas
--     (chatbot_transcripts.messages, role user / assistant), então já trazem o histórico desde o
--     início do GrooChat — inclusive respostas que chegaram em segundo plano (o bridge grava).
--     Conversa apagada some da contagem ao vivo; o rollup diário guarda o maior valor já visto
--     de cada dia, então o que já foi consolidado não diminui.
--   * Resumo diário em usage_agent_daily, pelo mesmo pg_cron (usage_rollup, redefinida aqui).

-- 1. Tabelas.
create table if not exists public.usage_agent_visits (
  id         uuid primary key,                   -- gerado no navegador (heartbeat faz upsert)
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  bot_id     text not null,                      -- chatbot_bots.id
  surface    text not null check (surface in ('pagina', 'flutuante')),
  started_at timestamptz not null,
  ended_at   timestamptz not null,
  active_ms  integer not null default 0 check (active_ms >= 0)
);
create index if not exists ix_usage_agent_visits_started on public.usage_agent_visits (started_at);

create table if not exists public.usage_agent_daily (
  dia       date not null,                       -- dia em America/Sao_Paulo
  user_id   uuid not null references auth.users(id) on delete cascade,
  bot_id    text not null,
  active_ms bigint not null default 0,
  sessoes   integer not null default 0,          -- aberturas do chat com uso
  perguntas integer not null default 0,
  respostas integer not null default 0,
  primary key (dia, user_id, bot_id)
);

alter table public.usage_agent_visits enable row level security;
alter table public.usage_agent_daily  enable row level security;
revoke all on public.usage_agent_visits, public.usage_agent_daily from anon, authenticated;

-- 2. Mensagens por (dia, usuário, agente) a partir das conversas salvas. Interno.
--    timestamp das mensagens = epoch em ms (ChatMessage.timestamp). Só lê transcripts
--    atualizados a partir de p_from (uma conversa com mensagem no período foi tocada depois dele).
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

-- 3. Coleta: usage_track ganha p_agents. A versão de 3 argumentos sai (com as duas, o PostgREST
--    não sabe qual chamar); quem ainda manda 3 argumentos cai nesta pelo default.
drop function if exists public.usage_track(uuid, jsonb, jsonb);

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
declare
  _uid uuid := auth.uid();
begin
  if _uid is null or p_session is null or not public.is_approved(_uid) then return; end if;
  if jsonb_typeof(p_visits) <> 'array' or jsonb_typeof(p_clicks) <> 'array' or jsonb_typeof(p_agents) <> 'array' then return; end if;
  if jsonb_array_length(p_visits) > 50 or jsonb_array_length(p_clicks) > 300 or jsonb_array_length(p_agents) > 50 then
    raise exception 'usage_track: payload grande demais';
  end if;

  insert into public.usage_visits as v (id, user_id, session_id, screen_key, path, prev_screen_key, started_at, ended_at, active_ms)
  select x.id, _uid, p_session, left(x.screen_key, 120), left(coalesce(x.path, ''), 300), left(x.prev_screen_key, 120),
         x.ini, x.fim,
         -- tempo ativo nunca passa da duração da visita (+5s de folga p/ relógio)
         least(greatest(coalesce(x.active_ms, 0), 0), extract(epoch from (x.fim - x.ini)) * 1000 + 5000)::int
  from (
    select r.*, least(r.started_at, now()) as ini,
           least(greatest(coalesce(r.ended_at, r.started_at), r.started_at), now()) as fim
    from jsonb_to_recordset(p_visits) as r(id uuid, screen_key text, path text, prev_screen_key text,
                                           started_at timestamptz, ended_at timestamptz, active_ms bigint)
    where r.id is not null and r.screen_key is not null and r.started_at is not null
      and r.started_at > now() - interval '2 days'
  ) x
  on conflict (id) do update set
    ended_at  = greatest(v.ended_at, excluded.ended_at),
    active_ms = greatest(v.active_ms, excluded.active_ms)
  where v.user_id = _uid;

  insert into public.usage_agent_visits as a (id, user_id, session_id, bot_id, surface, started_at, ended_at, active_ms)
  select x.id, _uid, p_session, left(x.bot_id, 120), x.surface, x.ini, x.fim,
         least(greatest(coalesce(x.active_ms, 0), 0), extract(epoch from (x.fim - x.ini)) * 1000 + 5000)::int
  from (
    select r.*, least(r.started_at, now()) as ini,
           least(greatest(coalesce(r.ended_at, r.started_at), r.started_at), now()) as fim
    from jsonb_to_recordset(p_agents) as r(id uuid, bot_id text, surface text,
                                           started_at timestamptz, ended_at timestamptz, active_ms bigint)
    where r.id is not null and r.bot_id is not null and r.surface in ('pagina', 'flutuante')
      and r.started_at is not null and r.started_at > now() - interval '2 days'
  ) x
  on conflict (id) do update set
    ended_at  = greatest(a.ended_at, excluded.ended_at),
    active_ms = greatest(a.active_ms, excluded.active_ms)
  where a.user_id = _uid;

  insert into public.usage_clicks (user_id, session_id, visit_id, screen_key, seq, target_key, target_label, ts)
  select _uid, p_session, x.visit_id, left(x.screen_key, 120), x.seq, left(x.target_key, 160), left(x.target_label, 80),
         least(coalesce(x.ts, now()), now())
  from jsonb_to_recordset(p_clicks) as x(visit_id uuid, screen_key text, seq int, target_key text, target_label text, ts timestamptz)
  where x.screen_key is not null and x.target_key is not null and x.seq is not null
  on conflict (session_id, seq) do nothing;
end;
$$;

revoke execute on function public.usage_track(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.usage_track(uuid, jsonb, jsonb, jsonb) to authenticated;

-- 4. Rollup: o de telas (igual ao anterior) + agentes. Tempo é recalculado exato; perguntas e
--    respostas guardam o maior valor já visto (conversa apagada depois não reduz o histórico).
--    Na 1ª execução as mensagens são consolidadas desde o início do GrooChat.
create or replace function public.usage_rollup()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  _desde  date;
  _desde_agente date;
begin
  -- Telas
  _desde := coalesce(
    (select max(dia) - 2 from public.usage_daily),
    (select min((started_at at time zone 'America/Sao_Paulo')::date) from public.usage_visits),
    _hoje
  );
  delete from public.usage_daily where dia >= _desde and dia < _hoje;
  insert into public.usage_daily (dia, user_id, screen_key, active_ms, visits, clicks)
  select dia, user_id, screen_key, sum(active_ms), sum(visits), sum(clicks)
  from (
    select (started_at at time zone 'America/Sao_Paulo')::date as dia, user_id, screen_key,
           active_ms::bigint as active_ms, 1 as visits, 0 as clicks
    from public.usage_visits
    where started_at >= (_desde::timestamp at time zone 'America/Sao_Paulo')
      and started_at <  (_hoje::timestamp  at time zone 'America/Sao_Paulo')
    union all
    select (ts at time zone 'America/Sao_Paulo')::date, user_id, screen_key, 0, 0, 1
    from public.usage_clicks
    where ts >= (_desde::timestamp at time zone 'America/Sao_Paulo')
      and ts <  (_hoje::timestamp  at time zone 'America/Sao_Paulo')
  ) t
  group by dia, user_id, screen_key;

  -- Agentes
  _desde_agente := coalesce((select max(dia) - 2 from public.usage_agent_daily), '2000-01-01'::date);

  insert into public.usage_agent_daily as d (dia, user_id, bot_id, active_ms, sessoes)
  select (started_at at time zone 'America/Sao_Paulo')::date, user_id, bot_id, sum(active_ms), count(*)
  from public.usage_agent_visits
  where started_at >= (_desde_agente::timestamp at time zone 'America/Sao_Paulo')
    and started_at <  (_hoje::timestamp at time zone 'America/Sao_Paulo')
  group by 1, 2, 3
  on conflict (dia, user_id, bot_id) do update set
    active_ms = excluded.active_ms,
    sessoes   = excluded.sessoes;

  insert into public.usage_agent_daily as d (dia, user_id, bot_id, perguntas, respostas)
  select dia, user_id, bot_id, perguntas, respostas
  from public.usage_agent_msgs(_desde_agente, _hoje - 1)
  on conflict (dia, user_id, bot_id) do update set
    perguntas = greatest(d.perguntas, excluded.perguntas),
    respostas = greatest(d.respostas, excluded.respostas);

  -- Retenção do bruto
  delete from public.usage_visits where started_at < now() - interval '90 days';
  delete from public.usage_clicks where ts < now() - interval '90 days';
  delete from public.usage_agent_visits where started_at < now() - interval '90 days';
end;
$$;

revoke execute on function public.usage_rollup() from public, anon, authenticated;

-- 5. Leitura (aba Agentes de IA): linhas (dia, usuário, agente) + catálogo de nomes.
--    Dias consolidados vêm do usage_agent_daily; os mais novos, do bruto + conversas.
create or replace function public.usage_agentes(p_from date, p_to date, p_users uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _corte date;
begin
  if not public.has_usage_access(auth.uid()) then raise exception 'Acesso negado'; end if;
  _corte := coalesce((select max(dia) from public.usage_agent_daily), '-infinity'::date);
  return jsonb_build_object(
    'bots', coalesce((select jsonb_agg(jsonb_build_object('id', b.id::text, 'label', b.label) order by b.label)
                      from public.chatbot_bots b), '[]'::jsonb),
    'linhas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'dia', dia, 'user_id', user_id, 'bot_id', bot_id, 'active_ms', active_ms,
               'sessoes', sessoes, 'perguntas', perguntas, 'respostas', respostas))
      from (
        select d.dia, d.user_id, d.bot_id, d.active_ms, d.sessoes::bigint as sessoes,
               d.perguntas::bigint as perguntas, d.respostas::bigint as respostas
        from public.usage_agent_daily d
        where d.dia between p_from and least(p_to, _corte)
        union all
        select dia, user_id, bot_id, sum(active_ms)::bigint, sum(sessoes)::bigint, sum(perguntas)::bigint, sum(respostas)::bigint
        from (
          select (v.started_at at time zone 'America/Sao_Paulo')::date as dia, v.user_id, v.bot_id,
                 v.active_ms::bigint as active_ms, 1::bigint as sessoes, 0::bigint as perguntas, 0::bigint as respostas
          from public.usage_agent_visits v
          where v.started_at >= (greatest(p_from, _corte + 1)::timestamp at time zone 'America/Sao_Paulo')
            and v.started_at <  ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
          union all
          select m.dia, m.user_id, m.bot_id, 0, 0, m.perguntas, m.respostas
          from public.usage_agent_msgs(greatest(p_from, _corte + 1), p_to) m
        ) vivo
        where greatest(p_from, _corte + 1) <= p_to
        group by dia, user_id, bot_id
      ) l
      where p_users is null or l.user_id = any(p_users)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.usage_agentes(date, date, uuid[]) from public, anon;
grant execute on function public.usage_agentes(date, date, uuid[]) to authenticated;

-- 6. Consolida já (traz o histórico de perguntas/respostas para o usage_agent_daily).
select public.usage_rollup();

notify pgrst, 'reload schema';
