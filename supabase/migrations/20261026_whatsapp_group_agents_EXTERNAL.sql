-- Projeto-alvo: Supabase EXTERNAL your-project-ref (Companium).
-- Feature: configuração de agente(s) de IA conectado(s) ao WhatsApp que respondem em grupos.
--
-- Segurança do desenho:
--   * Nasce DESABILITADO (enabled=false) e SEM grupos (allowlist vazia) -> nada responde até
--     um admin conectar o WhatsApp (QR) e habilitar explicitamente.
--   * require_mention default TRUE -> por padrão só responde quando mencionado/respondido.
--   * RLS restrita em TUDO (leitura inclusa): a config contém o prompt do agente e a lista de
--     grupos, dados sensíveis. Só ADMIN ou papel `whatsapp_editor`
--     (public.has_whatsapp_access(auth.uid())) lê/grava pela UI.
--   * whatsapp_known_groups é populada pelo serviço de sync via service_role (que ignora RLS);
--     a UI só LÊ (admin) para oferecer um seletor de grupos — authenticated NÃO escreve nela.

-- ---------------------------------------------------------------------------
-- 0) Papel de acesso + helper. A tela aparece p/ ADMIN ou p/ quem tiver o papel
--    `whatsapp_editor` (concedido pelo admin no painel /admin, botão por usuário).
--    OBS: `alter type ... add value` precisa estar COMMITADO antes de qualquer INSERT
--    desse valor. Se o SQL Editor reclamar de transação, rode esta linha sozinha 1x.
-- ---------------------------------------------------------------------------
alter type public.app_role add value if not exists 'whatsapp_editor';

create or replace function public.has_whatsapp_access(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin')
      or exists (
        select 1 from public.user_roles
        where user_id = _user_id and role::text = 'whatsapp_editor'
      )
$$;
revoke execute on function public.has_whatsapp_access(uuid) from public, anon;
grant execute on function public.has_whatsapp_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Config do agente WhatsApp (1 linha por conta/número conectado)
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_group_agents (
  id              bigint generated always as identity primary key,
  account_id      text not null unique,                       -- id da conta no OpenClaw (ex.: 'whatsapp-groobot')
  display_name    text not null default 'Agente WhatsApp',
  enabled         boolean not null default false,             -- MESTRE liga/desliga (nasce OFF)
  system_prompt   text not null default '',                   -- persona/instruções do agente
  require_mention boolean not null default true,              -- true = só quando mencionado/respondido; false = qualquer msg do grupo
  trigger_prefix  text not null default '',                   -- opcional: só responde msg que começa com isto (ex.: '/groo')
  group_scope     text not null default 'allowlist'           -- 'allowlist' = só grupos liberados; 'all' = qualquer grupo onde o número estiver
                  check (group_scope in ('allowlist','all')),
  group_allowlist jsonb not null default '[]'::jsonb,         -- [{ "id": "...", "name": "..." }] grupos onde PODE responder (quando scope='allowlist')
  tools_enabled   boolean not null default false,             -- true = agente usa FUNÇÕES (dados CRM/Meta/ClickUp via exec+mcporter, como os bots da equipe); false = só texto
  model           text not null default 'gpt-6-astra',
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.whatsapp_group_agents enable row level security;

-- Leitura: SÓ admin (config sensível).
drop policy if exists "wa_agents_read" on public.whatsapp_group_agents;
create policy "wa_agents_read"
  on public.whatsapp_group_agents for select to authenticated
  using (public.has_whatsapp_access(auth.uid()));

-- Insert/Update/Delete: SÓ admin.
drop policy if exists "wa_agents_insert" on public.whatsapp_group_agents;
create policy "wa_agents_insert"
  on public.whatsapp_group_agents for insert to authenticated
  with check (public.has_whatsapp_access(auth.uid()));

drop policy if exists "wa_agents_update" on public.whatsapp_group_agents;
create policy "wa_agents_update"
  on public.whatsapp_group_agents for update to authenticated
  using (public.has_whatsapp_access(auth.uid()))
  with check (public.has_whatsapp_access(auth.uid()));

drop policy if exists "wa_agents_delete" on public.whatsapp_group_agents;
create policy "wa_agents_delete"
  on public.whatsapp_group_agents for delete to authenticated
  using (public.has_whatsapp_access(auth.uid()));

-- ---------------------------------------------------------------------------
-- 2) Grupos descobertos (populado pelo serviço de sync via service_role)
--    A UI lê (admin) para oferecer um seletor em vez de digitar o JID na mão.
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_known_groups (
  account_id  text not null,
  group_id    text not null,
  group_name  text,
  last_seen   timestamptz not null default now(),
  primary key (account_id, group_id)
);

alter table public.whatsapp_known_groups enable row level security;

-- Leitura: SÓ admin. (Sem policies de escrita p/ authenticated -> só service_role escreve.)
drop policy if exists "wa_known_groups_read" on public.whatsapp_known_groups;
create policy "wa_known_groups_read"
  on public.whatsapp_known_groups for select to authenticated
  using (public.has_whatsapp_access(auth.uid()));

-- ---------------------------------------------------------------------------
-- Linha semente (desabilitada) para a UI ter o que editar no primeiro acesso.
-- ---------------------------------------------------------------------------
insert into public.whatsapp_group_agents (account_id, display_name, enabled, system_prompt, require_mention)
values (
  'whatsapp-groobot',
  'Agente WhatsApp (Grupos)',
  false,
  'Você é um assistente da Groohub que responde em grupos de WhatsApp. Seja claro, educado e objetivo. Só responda sobre o que souber; se não tiver certeza, diga que vai verificar. Nunca invente dados.',
  true
)
on conflict (account_id) do nothing;

notify pgrst, 'reload schema';
