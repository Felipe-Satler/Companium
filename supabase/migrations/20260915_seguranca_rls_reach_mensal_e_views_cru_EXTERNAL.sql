-- 20260915 — SEGURANÇA (RLS / escopo cross-tenant). Aplicado manualmente no projeto external
-- (your-project-ref) durante a auditoria de segurança; registrado aqui p/ rastreio.
-- Fecha DOIS vazamentos cross-tenant confirmados como LIVE:
--
--   #4  meta_ads_reach_mensal — a policy de leitura era "USING (true)" p/ {anon, authenticated},
--       ou seja QUALQUER um (até não logado) lia Client/Mes/Alcance de TODOS os clientes.
--       Troca por: equipe aprovada lê tudo; usuário-cliente só o próprio "Client".
--       Espelha meta_ads_ad_analysis (20260817).
--
--   #12 _v_*_raw — as views CRU (fontes NÃO escopadas por trás das v_* escopadas) tinham SELECT
--       concedido a {anon, authenticated} (e a _daily tinha CRUD completo p/ anon). Um usuário-
--       cliente lia os dados de TODOS os tenants consultando a raw direto, furando o escopo das
--       v_*. Revoga o acesso direto. As v_meta_google_ads/_daily já eram owner-rights (leem a raw
--       como dono → revoke não as afeta). v_kommo_completa era security_invoker=on (lia a raw como
--       o chamador) mas faz o escopo no PRÓPRIO WHERE via caller_kommo_cmpkeys(), então passa a
--       owner-rights p/ o revoke não a quebrar.
--
-- Idempotente. Nenhum código do app/bridge lê as _v_*_raw (só as v_* escopadas).

-- ===================== #4 — meta_ads_reach_mensal =====================
drop policy if exists "reach mensal leitura"             on public.meta_ads_reach_mensal;
drop policy if exists meta_ads_reach_mensal_read         on public.meta_ads_reach_mensal;
drop policy if exists meta_ads_reach_mensal_client_scope on public.meta_ads_reach_mensal;

create policy meta_ads_reach_mensal_read on public.meta_ads_reach_mensal
  as permissive for select to authenticated
  using (is_approved(auth.uid()));

create policy meta_ads_reach_mensal_client_scope on public.meta_ads_reach_mensal
  as restrictive for select to authenticated
  using (
    (select public.caller_ads_names()) is null
    or "Client" = any((select public.caller_ads_names())::text[])
  );

revoke select on public.meta_ads_reach_mensal from anon;

-- ===================== #12 — views CRU (bypass de escopo) =====================
revoke all on public._v_meta_google_ads_raw       from anon, authenticated;
revoke all on public._v_meta_google_ads_daily_raw from anon, authenticated;
alter view public.v_kommo_completa set (security_invoker=off);
revoke all on public._v_kommo_completa_raw         from anon, authenticated;
