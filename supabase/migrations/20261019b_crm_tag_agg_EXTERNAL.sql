-- PROJETO-ALVO: your-project-ref (companium / externalSupabase)
-- Rodar A MAO no SQL Editor, A MIGRATION INTEIRA DE UMA VEZ.
--
-- Tags de cliente no CRM = ETIQUETAS DO KOMMO, por lead (metadata->>'tags', texto separado por
-- virgula). Espelha a mv_kommo_crm_agg adicionando a dimensao `tags` (conjunto normalizado por
-- lead: UPPER+TRIM de cada item, distinto, ordenado, rejuntado por ", "). Somar sobre `tags`
-- reproduz EXATAMENTE a mv original (GROUP BY refinado) -> validado p/ Henrique_Couto.
--
-- Substitui a abordagem manual (crm_client_tags/crm_client_tag_assignments), que fica sem uso
-- (pode dropar depois; deixo intacta p/ nao destruir dado sem pedido).

-- 1) MV espelhada com a dimensao de tag
drop materialized view if exists public.mv_kommo_crm_tag_agg;
create materialized view public.mv_kommo_crm_tag_agg as
with src as (
  select
    r.client,
    r."Médico"       as medico,
    r."Médicos"      as medicos,
    r."Origem"       as origem,
    r."Especialidade" as especialidade,
    coalesce((
      select string_agg(tt, ', ' order by tt)
      from (
        select distinct upper(trim(x)) as tt
        from unnest(string_to_array(r.metadata->>'tags', ',')) as x
        where trim(x) <> ''
      ) q
    ), '') as tags,
    r.created_at,
    r."Consulta Agendada Em"            as d_cons_ag,
    r."Dia da Consulta Realizada"        as d_cons_re,
    r."Procedimento Agendado Em"         as d_proc_ag,
    r."Dia do Procedimento Realizado"    as d_proc_re,
    r."Valor da Consulta"                as v_cons,
    r."Valor do Procedimento"            as v_proc
  from public."_v_kommo_completa_raw" r
  where not exists (
    select 1 from public.crm_leads_excluidos x
    where x.kommo_id = r.id_externo and (x.client is null or x.client = r.client)
  )
),
ev as (
  select client, medico, medicos, origem, especialidade, tags,
         'lead'::text as event_type,
         (created_at at time zone 'America/Sao_Paulo')::date as event_date,
         0::numeric as valor
  from src where created_at is not null
  union all
  select client, medico, medicos, origem, especialidade, tags,
         'consulta_agendada', public.to_date_key(d_cons_ag), public.parse_brl(v_cons)
  from src where public.to_date_key(d_cons_ag) is not null
  union all
  select client, medico, medicos, origem, especialidade, tags,
         'consulta_realizada', public.to_date_key(d_cons_re), public.parse_brl(v_cons)
  from src where public.to_date_key(d_cons_re) is not null
  union all
  select client, medico, medicos, origem, especialidade, tags,
         'proc_agendado', public.to_date_key(d_proc_ag), public.parse_brl(v_proc)
  from src where public.to_date_key(d_proc_ag) is not null
  union all
  select client, medico, medicos, origem, especialidade, tags,
         'proc_realizado', public.to_date_key(d_proc_re), public.parse_brl(v_proc)
  from src where public.to_date_key(d_proc_re) is not null
)
select client, medico, medicos, origem, especialidade, tags, event_type, event_date,
       count(*) as qtd, sum(valor) as valor
from ev
group by client, medico, medicos, origem, especialidade, tags, event_type, event_date;

-- indice unico (exige p/ REFRESH ... CONCURRENTLY) espelhando ux_kommo_agg + tags
create unique index if not exists ux_kommo_tag_agg
  on public.mv_kommo_crm_tag_agg (client, medico, medicos, origem, especialidade, tags, event_type, event_date)
  nulls not distinct;
create index if not exists ix_kommo_tag_agg_date on public.mv_kommo_crm_tag_agg (event_date);
create index if not exists ix_kommo_tag_agg_client_date on public.mv_kommo_crm_tag_agg (client, event_date);

-- 2) View com o MESMO escopo/RLS da v_kommo_crm_agg (equipe ve tudo; usuario-cliente so o seu)
create or replace view public.v_kommo_crm_tag_agg as
select client, medico, medicos, origem, especialidade, tags, event_type, event_date, qtd, valor
from public.mv_kommo_crm_tag_agg
where public.is_approved(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid)
  and (((select public.caller_kommo_cmpkeys())) is null
       or (public.client_matchkey(client) = any (((select public.caller_kommo_cmpkeys()))::text[])));

grant select on public.v_kommo_crm_tag_agg to authenticated;

-- 3) Refresh no MESMO cron da mv original (a cada 15 min). CONCURRENTLY usa o indice unico.
select cron.schedule(
  'refresh_mv_kommo_crm_tag_agg',
  '*/15 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_kommo_crm_tag_agg'
);

notify pgrst, 'reload schema';
