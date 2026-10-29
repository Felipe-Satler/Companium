-- Projeto-alvo: Supabase EXTERNAL your-project-ref (Companium).
-- Feature: ACOMPANHAMENTO dos grupos do agente de WhatsApp — andamento do grupo,
--          sentimento da conversa e andamento do atendimento, por grupo.
--
-- Pré-requisito: rode ANTES a migration 20261026_whatsapp_group_agents_EXTERNAL.sql
--   (cria whatsapp_group_agents/whatsapp_known_groups + a função public.has_whatsapp_access,
--    reusada aqui para o RLS).
--
-- Desenho de segurança (igual às tabelas irmãs do WhatsApp):
--   * Dados sensíveis (resumo de conversas de grupo) -> RLS admin-only na LEITURA
--     (public.has_whatsapp_access(auth.uid())): só admin OU papel `whatsapp_editor`.
--   * Escrita SOMENTE pelo serviço de análise via service_role (bypassa RLS). authenticated
--     NÃO tem policy de escrita -> a UI só lê.
--   * Nasce vazia: a tela mostra "sem dados ainda" até o número conectar e o job de análise rodar.

-- ---------------------------------------------------------------------------
-- Snapshot mais recente por grupo (1 linha por conta+grupo; o job faz upsert).
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_group_insights (
  account_id        text not null,                             -- conta OpenClaw (ex.: 'whatsapp-groobot')
  group_id          text not null,                             -- JID do grupo
  group_name        text,
  window_start      timestamptz,                               -- início da janela analisada
  window_end        timestamptz,                               -- fim da janela analisada
  message_count     integer not null default 0,                -- mensagens na janela
  participant_count integer not null default 0,                -- participantes ativos na janela
  last_message_at   timestamptz,                               -- última mensagem vista
  sentiment         text not null default 'sem_dados'          -- sentimento agregado da conversa
                    check (sentiment in ('positivo','neutro','negativo','misto','sem_dados')),
  sentiment_score   numeric,                                   -- -1 (muito negativo) .. +1 (muito positivo)
  attendance_status text not null default 'sem_atividade'      -- andamento do atendimento no grupo
                    check (attendance_status in ('sem_atividade','aguardando','em_andamento','resolvido')),
  summary           text,                                      -- resumo curto do andamento (1-3 frases)
  highlights        jsonb not null default '[]'::jsonb,        -- pontos de atenção: [{ "tipo": "...", "texto": "..." }]
  analyzed_by       text,                                      -- modelo/mecanismo que gerou (ex.: 'gpt-6-astra')
  updated_at        timestamptz not null default now(),
  primary key (account_id, group_id)
);

create index if not exists idx_wa_group_insights_updated
  on public.whatsapp_group_insights (account_id, updated_at desc);

alter table public.whatsapp_group_insights enable row level security;

-- Leitura: SÓ admin / whatsapp_editor (resumo de conversa é dado sensível).
drop policy if exists "wa_group_insights_read" on public.whatsapp_group_insights;
create policy "wa_group_insights_read"
  on public.whatsapp_group_insights for select to authenticated
  using (public.has_whatsapp_access(auth.uid()));

-- Sem policies de escrita p/ authenticated -> só service_role (job de análise) grava.

notify pgrst, 'reload schema';
