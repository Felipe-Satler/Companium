-- Projeto-alvo: Supabase EXTERNAL your-project-ref (Companium).
-- Expansao do ACOMPANHAMENTO dos grupos: temperatura do lead (quente/morno/frio),
-- potencial de resultado, retorno (quem aguarda resposta, quantas respostas do agente x cliente)
-- e historico de introducao (primeiro contato + resumo da abertura).
--
-- Pre-requisito: rodar ANTES a 20261026b (cria whatsapp_group_insights).
-- Tudo ADITIVO (ADD COLUMN IF NOT EXISTS): nao mexe em RLS, policies ou dados existentes.
-- A escrita continua SOMENTE via service_role (job de analise); a UI so le.

alter table public.whatsapp_group_insights
  add column if not exists lead_temperature    text not null default 'sem_dados',
  add column if not exists result_score         numeric,
  add column if not exists awaiting_reply        boolean not null default false,
  add column if not exists agent_reply_count     integer not null default 0,
  add column if not exists client_message_count  integer not null default 0,
  add column if not exists first_contact_at      timestamptz,
  add column if not exists intro_summary         text;

-- Dominio de lead_temperature (idempotente: remove antes de recriar).
alter table public.whatsapp_group_insights
  drop constraint if exists whatsapp_group_insights_lead_temperature_check;
alter table public.whatsapp_group_insights
  add constraint whatsapp_group_insights_lead_temperature_check
  check (lead_temperature in ('quente','morno','frio','sem_dados'));

notify pgrst, 'reload schema';
