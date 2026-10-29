-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo e ANTES de reiniciar o openclaw-bridge.
--
-- MULTI-TENANCY DOS BOTS DE CHAT.
-- Adiciona o vínculo de tenancy por bot no catálogo `chatbot_bots`. Cada bot passa a ter um
-- MODO DE ACESSO explícito:
--   - internal_unrestricted (DEFAULT): bots internos de operação — visão ampla, igual a hoje.
--   - restricted: bots de cliente — escopados por tenant + clínicas + capacidades.
-- Os bots existentes assumem internal_unrestricted (nada muda no comportamento atual).
--
-- Onde os dados passam a viver: colunas em `chatbot_bots`. O openclaw-bridge lê essas colunas
-- (service key) em getBots()/resolveAgent() e deriva o tenantContext server-side. A tela de
-- Administração (aba "Tenancy de Bots") edita tenant_id/allowed_clinic_ids (RLS admin-only).
-- Toda alteração fica registrada em `chatbot_bot_tenancy_audit` por um trigger (valor
-- anterior/novo, quem alterou, quando).

-- 1. Colunas de tenancy no catálogo de bots. Idempotente.
alter table public.chatbot_bots
  add column if not exists access_mode text not null default 'internal_unrestricted',
  add column if not exists tenant_id text,
  add column if not exists allowed_clinic_ids text[] not null default '{}',
  add column if not exists allowed_capabilities text[] not null default '{*}';

-- Só dois modos válidos. NOT VALID + validate p/ não travar caso haja lixo (não deve haver).
do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chatbot_bots_access_mode_chk'
  ) then
    alter table public.chatbot_bots
      add constraint chatbot_bots_access_mode_chk
      check (access_mode in ('internal_unrestricted','restricted'));
  end if;
end
$do$;

-- 2. Tabela de auditoria das alterações de tenancy.
create table if not exists public.chatbot_bot_tenancy_audit (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_value jsonb,
  new_value jsonb
);

alter table public.chatbot_bot_tenancy_audit enable row level security;

-- 3. Trigger que registra QUALQUER mudança nos campos de tenancy — auditoria automática,
--    independente de quem escreveu (não confia no cliente para gravar o log). SECURITY DEFINER
--    p/ inserir no audit mesmo com a RLS restritiva de insert.
create or replace function public.log_chatbot_bot_tenancy_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if (new.access_mode is distinct from old.access_mode)
     or (new.tenant_id is distinct from old.tenant_id)
     or (new.allowed_clinic_ids is distinct from old.allowed_clinic_ids)
     or (new.allowed_capabilities is distinct from old.allowed_capabilities) then
    insert into public.chatbot_bot_tenancy_audit (bot_id, changed_by, old_value, new_value)
    values (
      old.id,
      auth.uid(),
      jsonb_build_object(
        'access_mode', old.access_mode,
        'tenant_id', old.tenant_id,
        'allowed_clinic_ids', old.allowed_clinic_ids,
        'allowed_capabilities', old.allowed_capabilities
      ),
      jsonb_build_object(
        'access_mode', new.access_mode,
        'tenant_id', new.tenant_id,
        'allowed_clinic_ids', new.allowed_clinic_ids,
        'allowed_capabilities', new.allowed_capabilities
      )
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_chatbot_bots_tenancy_audit on public.chatbot_bots;
create trigger trg_chatbot_bots_tenancy_audit
  after update on public.chatbot_bots
  for each row execute function public.log_chatbot_bot_tenancy_change();

-- 4. RLS. Escrita das colunas de tenancy é só p/ ADMIN; leitura do catálogo segue como está
--    (a UI já lê chatbot_bots como authenticated). O bridge usa service key e ignora RLS.
--    Assumimos que RLS já está habilitada em chatbot_bots (usada por UserBotSettings). Se não,
--    habilite: alter table public.chatbot_bots enable row level security;
drop policy if exists chatbot_bots_admin_update on public.chatbot_bots;
create policy chatbot_bots_admin_update on public.chatbot_bots
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Auditoria: admin lê; ninguém escreve direto (só o trigger SECURITY DEFINER insere).
drop policy if exists chatbot_bot_tenancy_audit_admin_select on public.chatbot_bot_tenancy_audit;
create policy chatbot_bot_tenancy_audit_admin_select on public.chatbot_bot_tenancy_audit
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select on public.chatbot_bot_tenancy_audit to authenticated;

notify pgrst, 'reload schema';
