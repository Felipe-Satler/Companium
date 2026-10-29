-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo (senão o tracker chama uma RPC que não
-- existe e o toggle "Uso" da Administração falha ao inserir o papel — valor de enum inexistente).
--
-- PÁGINA "USO DO COMPANIUM" (rota /uso — tempo ativo por tela, cliques e navegação):
--   * Coleta: o frontend chama usage_track() a cada ~15s (e ao esconder/fechar a aba) com as
--     visitas de tela e os cliques acumulados. As tabelas NÃO têm policy: ninguém lê nem grava
--     direto, só pelas RPCs SECURITY DEFINER abaixo (o user_id sai do auth.uid(), não do cliente).
--   * Leitura: RPCs usage_* que conferem has_usage_access() = admin OU papel `usage_viewer`
--     (liberado na Administração, divisão "USO"). Devolvem jsonb (sem o teto de linhas do
--     PostgREST).
--   * Retenção: eventos brutos ficam 90 dias; o resumo diário (usage_daily) fica para sempre.
--     Rollup + limpeza por pg_cron, 1x/dia.
--   * "Tempo ativo" = aba visível + janela em foco + interação nos últimos 60s (regra no
--     frontend, src/lib/usage/tracker.ts). Telas: chave "secao.tela" (src/lib/usage/screens.ts).

-- 1. Papel novo. Idempotente. O helper compara role::text p/ não usar o valor novo como literal
--    de enum na mesma transação ("unsafe use of new value").
alter type public.app_role add value if not exists 'usage_viewer';

create or replace function public.has_usage_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'usage_viewer'
      )
$$;

revoke execute on function public.has_usage_access(uuid) from public, anon;
grant execute on function public.has_usage_access(uuid) to authenticated;

-- 2. Tabelas. Seção = split_part(screen_key, '.', 1) (não é gravada à parte).
create table if not exists public.usage_visits (
  id              uuid primary key,              -- gerado no navegador (heartbeat faz upsert)
  user_id         uuid not null references auth.users(id) on delete cascade,
  session_id      uuid not null,
  screen_key      text not null,
  path            text not null,
  prev_screen_key text,                          -- tela anterior na mesma sessão (null = início)
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  active_ms       integer not null default 0 check (active_ms >= 0)
);
create index if not exists ix_usage_visits_started on public.usage_visits (started_at);
create index if not exists ix_usage_visits_user_started on public.usage_visits (user_id, started_at);

create table if not exists public.usage_clicks (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null,
  visit_id     uuid,
  screen_key   text not null,
  seq          integer not null,                 -- ordem do clique na sessão
  target_key   text not null,
  target_label text,
  ts           timestamptz not null,
  unique (session_id, seq)                       -- reenvio após falha de rede não duplica
);
create index if not exists ix_usage_clicks_ts on public.usage_clicks (ts);
create index if not exists ix_usage_clicks_user_ts on public.usage_clicks (user_id, ts);

create table if not exists public.usage_daily (
  dia        date not null,                      -- dia em America/Sao_Paulo
  user_id    uuid not null references auth.users(id) on delete cascade,
  screen_key text not null,
  active_ms  bigint not null default 0,
  visits     integer not null default 0,
  clicks     integer not null default 0,
  primary key (dia, user_id, screen_key)
);

alter table public.usage_visits enable row level security;
alter table public.usage_clicks enable row level security;
alter table public.usage_daily  enable row level security;
revoke all on public.usage_visits, public.usage_clicks, public.usage_daily from anon, authenticated;

-- 3. Coleta. Um POST por flush: upsert das visitas abertas + insert dos cliques novos.
create or replace function public.usage_track(p_session uuid, p_visits jsonb default '[]'::jsonb, p_clicks jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null or p_session is null or not public.is_approved(_uid) then return; end if;
  if jsonb_typeof(p_visits) <> 'array' or jsonb_typeof(p_clicks) <> 'array' then return; end if;
  if jsonb_array_length(p_visits) > 50 or jsonb_array_length(p_clicks) > 300 then
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

  insert into public.usage_clicks (user_id, session_id, visit_id, screen_key, seq, target_key, target_label, ts)
  select _uid, p_session, x.visit_id, left(x.screen_key, 120), x.seq, left(x.target_key, 160), left(x.target_label, 80),
         least(coalesce(x.ts, now()), now())
  from jsonb_to_recordset(p_clicks) as x(visit_id uuid, screen_key text, seq int, target_key text, target_label text, ts timestamptz)
  where x.screen_key is not null and x.target_key is not null and x.seq is not null
  on conflict (session_id, seq) do nothing;
end;
$$;

revoke execute on function public.usage_track(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.usage_track(uuid, jsonb, jsonb) to authenticated;

-- 4. Rollup diário + retenção. Recalcula do último dia consolidado - 2 até ontem (idempotente;
--    se o cron ficar parado uns dias, a próxima execução cobre o buraco enquanto o bruto existir).
create or replace function public.usage_rollup()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  _desde date;
begin
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

  delete from public.usage_visits where started_at < now() - interval '90 days';
  delete from public.usage_clicks where ts < now() - interval '90 days';
end;
$$;

revoke execute on function public.usage_rollup() from public, anon, authenticated;

-- Dias já consolidados vêm do usage_daily; os mais novos (hoje, e o que o cron ainda não
-- consolidou), do bruto. Interno: só as RPCs de leitura chamam.
create or replace function public.usage_daily_live(p_from date, p_to date)
returns table (dia date, user_id uuid, screen_key text, active_ms bigint, visits bigint, clicks bigint)
language sql
stable
security definer
set search_path = public
as $$
  with corte as (select coalesce(max(d.dia), '-infinity'::date) as c from public.usage_daily d)
  select d.dia, d.user_id, d.screen_key, d.active_ms, d.visits::bigint, d.clicks::bigint
  from public.usage_daily d, corte
  where d.dia between p_from and p_to and d.dia <= corte.c
  union all
  select dia, user_id, screen_key, sum(active_ms)::bigint, sum(visits)::bigint, sum(clicks)::bigint
  from (
    select (v.started_at at time zone 'America/Sao_Paulo')::date as dia, v.user_id, v.screen_key,
           v.active_ms as active_ms, 1 as visits, 0 as clicks
    from public.usage_visits v
    union all
    select (c.ts at time zone 'America/Sao_Paulo')::date, c.user_id, c.screen_key, 0, 0, 1
    from public.usage_clicks c
  ) raw, corte
  where raw.dia between p_from and p_to and raw.dia > corte.c
  group by dia, user_id, screen_key
$$;

revoke execute on function public.usage_daily_live(date, date) from public, anon, authenticated;

-- 5. Leitura (página /uso). p_users / p_screens nulos = todos. p_screens aceita a tela exata
--    ("clientes.crm") ou a seção inteira ("clientes.*" — cobre também telas que surgirem depois).
create or replace function public.usage_screen_match(_key text, _screens text[])
returns boolean
language sql
immutable
as $$
  select _screens is null or _key = any(_screens) or (split_part(_key, '.', 1) || '.*') = any(_screens)
$$;

-- Usuários aprovados + tipo (o usage_viewer não-admin não pode chamar get_users_with_emails).
create or replace function public.usage_usuarios()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_usage_access(auth.uid()) then raise exception 'Acesso negado'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id,
             'email', u.email,
             'tipo', case when s.user_id is not null then 'cliente'
                          when public.has_role(u.id, 'admin') then 'admin'
                          else 'equipe' end)
           order by u.email)
    from auth.users u
    join public.user_approvals a on a.user_id = u.id and a.status = 'approved'
    left join public.user_client_scope s on s.user_id = u.id
  ), '[]'::jsonb);
end;
$$;

-- Base de tudo da aba Tempo/Adoção: (dia, usuário, tela) → tempo ativo, visitas, cliques.
create or replace function public.usage_diario(p_from date, p_to date, p_users uuid[] default null, p_screens text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_usage_access(auth.uid()) then raise exception 'Acesso negado'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'dia', l.dia, 'user_id', l.user_id, 'screen_key', l.screen_key,
             'active_ms', l.active_ms, 'visits', l.visits, 'clicks', l.clicks))
    from public.usage_daily_live(p_from, p_to) l
    where (p_users is null or l.user_id = any(p_users))
      and public.usage_screen_match(l.screen_key, p_screens)
  ), '[]'::jsonb);
end;
$$;

-- Horário de uso (dia da semana × hora, fuso de SP). Só do bruto (últimos 90 dias).
create or replace function public.usage_horarios(p_from date, p_to date, p_users uuid[] default null, p_screens text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_usage_access(auth.uid()) then raise exception 'Acesso negado'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('dow', dow, 'hora', hora, 'active_ms', ms, 'usuarios', usuarios))
    from (
      select extract(isodow from v.started_at at time zone 'America/Sao_Paulo')::int as dow,
             extract(hour   from v.started_at at time zone 'America/Sao_Paulo')::int as hora,
             sum(v.active_ms)::bigint as ms,
             count(distinct v.user_id) as usuarios
      from public.usage_visits v
      where v.started_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
        and v.started_at <  ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
        and (p_users is null or v.user_id = any(p_users))
        and public.usage_screen_match(v.screen_key, p_screens)
      group by 1, 2
    ) t
  ), '[]'::jsonb);
end;
$$;

-- Aba Navegação: transições tela→tela, top cliques, sequências de 3 cliques e telas de saída.
create or replace function public.usage_navegacao(p_from date, p_to date, p_users uuid[] default null, p_screens text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _ini timestamptz := p_from::timestamp at time zone 'America/Sao_Paulo';
  _fim timestamptz := (p_to + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if not public.has_usage_access(auth.uid()) then raise exception 'Acesso negado'; end if;
  return jsonb_build_object(
    'transicoes', coalesce((
      select jsonb_agg(jsonb_build_object('de', de, 'para', para, 'n', n, 'usuarios', usuarios) order by n desc)
      from (
        select coalesce(v.prev_screen_key, '_inicio') as de, v.screen_key as para,
               count(*) as n, count(distinct v.user_id) as usuarios
        from public.usage_visits v
        where v.started_at >= _ini and v.started_at < _fim
          and (p_users is null or v.user_id = any(p_users))
          and (p_screens is null or public.usage_screen_match(v.screen_key, p_screens) or public.usage_screen_match(v.prev_screen_key, p_screens))
          and v.screen_key is distinct from v.prev_screen_key
        group by 1, 2
        order by n desc
        limit 300
      ) t
    ), '[]'::jsonb),
    'cliques', coalesce((
      select jsonb_agg(jsonb_build_object('screen_key', screen_key, 'target_key', target_key, 'label', label,
                                          'n', n, 'usuarios', usuarios) order by n desc)
      from (
        select c.screen_key, c.target_key, mode() within group (order by c.target_label) as label,
               count(*) as n, count(distinct c.user_id) as usuarios
        from public.usage_clicks c
        where c.ts >= _ini and c.ts < _fim
          and (p_users is null or c.user_id = any(p_users))
          and public.usage_screen_match(c.screen_key, p_screens)
        group by 1, 2
        order by n desc
        limit 300
      ) t
    ), '[]'::jsonb),
    'sequencias', coalesce((
      select jsonb_agg(jsonb_build_object('a', a, 'b', b, 'c', c, 'la', la, 'lb', lb, 'lc', lc,
                                          'n', n, 'usuarios', usuarios) order by n desc)
      from (
        select a, b, c, max(la) as la, max(lb) as lb, max(lc) as lc, count(*) as n, count(distinct user_id) as usuarios
        from (
          select d.user_id, d.screen_key,
                 d.target_key as a, lead(d.target_key, 1) over w as b, lead(d.target_key, 2) over w as c,
                 d.target_label as la, lead(d.target_label, 1) over w as lb, lead(d.target_label, 2) over w as lc
          from (
            -- cliques repetidos em sequência (A, A, A) contam como um só
            select c.*, lag(c.target_key) over (partition by c.session_id order by c.seq) as anterior
            from public.usage_clicks c
            where c.ts >= _ini and c.ts < _fim
              and (p_users is null or c.user_id = any(p_users))
          ) d
          where d.anterior is distinct from d.target_key
          window w as (partition by d.session_id order by d.seq)
        ) s
        where b is not null and c is not null
          and public.usage_screen_match(s.screen_key, p_screens)
        group by a, b, c
        order by n desc
        limit 50
      ) t
    ), '[]'::jsonb),
    'saidas', coalesce((
      select jsonb_agg(jsonb_build_object('screen_key', screen_key, 'n', n) order by n desc)
      from (
        select screen_key, count(*) as n
        from (
          select distinct on (v.session_id) v.session_id, v.screen_key
          from public.usage_visits v
          where v.started_at >= _ini and v.started_at < _fim
            and (p_users is null or v.user_id = any(p_users))
          order by v.session_id, v.started_at desc
        ) u
        where public.usage_screen_match(u.screen_key, p_screens)
        group by 1
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- Timeline de um usuário num dia: visitas e cliques em ordem.
create or replace function public.usage_sessao(p_user uuid, p_dia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _ini timestamptz := p_dia::timestamp at time zone 'America/Sao_Paulo';
  _fim timestamptz := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if not public.has_usage_access(auth.uid()) then raise exception 'Acesso negado'; end if;
  return jsonb_build_object(
    'visitas', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'session_id', v.session_id, 'screen_key', v.screen_key,
                                          'started_at', v.started_at, 'ended_at', v.ended_at, 'active_ms', v.active_ms)
                       order by v.started_at)
      from public.usage_visits v
      where v.user_id = p_user and v.started_at >= _ini and v.started_at < _fim
    ), '[]'::jsonb),
    'cliques', coalesce((
      select jsonb_agg(jsonb_build_object('visit_id', c.visit_id, 'session_id', c.session_id, 'screen_key', c.screen_key,
                                          'seq', c.seq, 'target_key', c.target_key, 'label', c.target_label, 'ts', c.ts)
                       order by c.ts, c.seq)
      from public.usage_clicks c
      where c.user_id = p_user and c.ts >= _ini and c.ts < _fim
    ), '[]'::jsonb)
  );
end;
$$;

-- CSV de cliques brutos (teto de 50 mil linhas).
create or replace function public.usage_cliques_export(p_from date, p_to date, p_users uuid[] default null, p_screens text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_usage_access(auth.uid()) then raise exception 'Acesso negado'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('ts', ts, 'user_id', user_id, 'session_id', session_id, 'seq', seq,
                                        'screen_key', screen_key, 'target_key', target_key, 'label', target_label)
                     order by ts, seq)
    from (
      select c.* from public.usage_clicks c
      where c.ts >= (p_from::timestamp at time zone 'America/Sao_Paulo')
        and c.ts <  ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
        and (p_users is null or c.user_id = any(p_users))
        and public.usage_screen_match(c.screen_key, p_screens)
      order by c.ts, c.seq
      limit 50000
    ) t
  ), '[]'::jsonb);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.usage_usuarios()',
    'public.usage_diario(date, date, uuid[], text[])',
    'public.usage_horarios(date, date, uuid[], text[])',
    'public.usage_navegacao(date, date, uuid[], text[])',
    'public.usage_sessao(uuid, date)',
    'public.usage_cliques_export(date, date, uuid[], text[])'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 6. Cron: 03:15 em SP (06:15 UTC).
select cron.schedule('usage_rollup', '15 6 * * *', 'select public.usage_rollup()');

notify pgrst, 'reload schema';
