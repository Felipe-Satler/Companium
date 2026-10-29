-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o primário do
-- config.toml. Rode este SQL no SQL Editor desse projeto (PAT via Management API dá 403 em DDL).
--
-- OBJETIVO: corrigir o DIA do lead na mv_kommo_crm_agg. O event_type='lead' usava
--   ((created_at AT TIME ZONE 'UTC'))::date   -- dia em UTC
-- enquanto TODOS os outros eventos usam to_date_key(...) (data local) e o app inteiro filtra
-- por dia em Brasília (startOfDayBRT/endOfDayBRT). Efeito: leads criados ~21:00–23:59 (BRT)
-- caíam no DIA SEGUINTE (UTC) e inflavam o "hoje" do painel (ex.: Fábio_Morais 01/09 = 8 na
-- MV vs 2 reais em BRT — 6 eram da noite de 31/08 BRT). Diagnóstico 2026-09-01.
--
-- CORREÇÃO: única mudança é UTC -> America/Sao_Paulo no ramo 'lead'. Resto VERBATIM da
-- definição atual. Recria a MV (não há CREATE OR REPLACE p/ matview), preservando os 3
-- índices (incl. o UNIQUE que habilita REFRESH CONCURRENTLY) e os grants da view dependente.
-- `drop view` SEM cascade: se algo inesperado depender da view, a transação falha (seguro).

begin;

drop view if exists public.v_kommo_crm_agg;
drop materialized view if exists public.mv_kommo_crm_agg;

create materialized view public.mv_kommo_crm_agg as
 WITH src AS (
         SELECT _v_kommo_completa_raw.client,
            _v_kommo_completa_raw."Médico" AS medico,
            _v_kommo_completa_raw."Médicos" AS medicos,
            _v_kommo_completa_raw."Origem" AS origem,
            _v_kommo_completa_raw."Especialidade" AS especialidade,
            _v_kommo_completa_raw.created_at,
            _v_kommo_completa_raw."Consulta Agendada Em" AS d_cons_ag,
            _v_kommo_completa_raw."Dia da Consulta Realizada" AS d_cons_re,
            _v_kommo_completa_raw."Procedimento Agendado Em" AS d_proc_ag,
            _v_kommo_completa_raw."Dia do Procedimento Realizado" AS d_proc_re,
            _v_kommo_completa_raw."Valor da Consulta" AS v_cons,
            _v_kommo_completa_raw."Valor do Procedimento" AS v_proc
           FROM _v_kommo_completa_raw
          WHERE _v_kommo_completa_raw.id NOT IN (30001248, 2320012)
        ), ev AS (
         SELECT src.client,
            src.medico,
            src.medicos,
            src.origem,
            src.especialidade,
            'lead'::text AS event_type,
            -- ⬇️ ÚNICA MUDANÇA: dia do lead em Brasília (era 'UTC')
            ((src.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date AS event_date,
            (0)::numeric AS valor
           FROM src
          WHERE (src.created_at IS NOT NULL)
        UNION ALL
         SELECT src.client,
            src.medico,
            src.medicos,
            src.origem,
            src.especialidade,
            'consulta_agendada'::text,
            to_date_key(src.d_cons_ag) AS to_date_key,
            parse_brl(src.v_cons) AS parse_brl
           FROM src
          WHERE (to_date_key(src.d_cons_ag) IS NOT NULL)
        UNION ALL
         SELECT src.client,
            src.medico,
            src.medicos,
            src.origem,
            src.especialidade,
            'consulta_realizada'::text,
            to_date_key(src.d_cons_re) AS to_date_key,
            parse_brl(src.v_cons) AS parse_brl
           FROM src
          WHERE (to_date_key(src.d_cons_re) IS NOT NULL)
        UNION ALL
         SELECT src.client,
            src.medico,
            src.medicos,
            src.origem,
            src.especialidade,
            'proc_agendado'::text,
            to_date_key(src.d_proc_ag) AS to_date_key,
            parse_brl(src.v_proc) AS parse_brl
           FROM src
          WHERE (to_date_key(src.d_proc_ag) IS NOT NULL)
        UNION ALL
         SELECT src.client,
            src.medico,
            src.medicos,
            src.origem,
            src.especialidade,
            'proc_realizado'::text,
            to_date_key(src.d_proc_re) AS to_date_key,
            parse_brl(src.v_proc) AS parse_brl
           FROM src
          WHERE (to_date_key(src.d_proc_re) IS NOT NULL)
        )
 SELECT client,
    medico,
    medicos,
    origem,
    especialidade,
    event_type,
    event_date,
    count(*) AS qtd,
    sum(valor) AS valor
   FROM ev
  GROUP BY client, medico, medicos, origem, especialidade, event_type, event_date;

-- Índices VERBATIM (consulta B). O UNIQUE (NULLS NOT DISTINCT) habilita REFRESH CONCURRENTLY.
create unique index ux_kommo_agg on public.mv_kommo_crm_agg
  using btree (client, medico, medicos, origem, especialidade, event_type, event_date) nulls not distinct;
create index ix_kommo_agg_date on public.mv_kommo_crm_agg using btree (event_date);
create index ix_kommo_agg_client_date on public.mv_kommo_crm_agg using btree (client, event_date);

analyze public.mv_kommo_crm_agg;

-- View dependente recriada VERBATIM (da 20260730c) — escopo por client (usuário-cliente).
create view public.v_kommo_crm_agg as
 SELECT client,
    medico,
    medicos,
    origem,
    especialidade,
    event_type,
    event_date,
    qtd,
    valor
   FROM mv_kommo_crm_agg
  WHERE is_approved(COALESCE(NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text), NULLIF(current_setting('request.jwt.claims'::text, true), ''::text)::jsonb ->> 'sub'::text)::uuid)
    AND ((select public.caller_kommo_cmpkeys()) IS NULL OR public.client_matchkey(client) = ANY((select public.caller_kommo_cmpkeys())::text[]));

-- Grants VERBATIM (consulta C): conjunto default do Supabase (a RLS is_approved barra anon).
grant all on public.v_kommo_crm_agg to anon, authenticated, service_role;

-- Sanidade ANTES de commitar: deve retornar 2.
select coalesce(sum(qtd), 0) as leads_fabio_hoje_brt
  from mv_kommo_crm_agg
 where event_type = 'lead'
   and client = 'Fábio_Morais'
   and event_date = (now() at time zone 'America/Sao_Paulo')::date;

commit;   -- se deu 2. Se vier estranho: rollback;

notify pgrst, 'reload schema';
