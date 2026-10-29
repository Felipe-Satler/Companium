-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES (ou junto) de subir o frontend novo.
--
-- SEÇÃO CAPTAÇÃO — Pacing mensal por CANAL:
--   Até aqui a `captacao_config` guardava UMA meta mensal por mês (`mes` era a PK sozinho),
--   compartilhada entre as páginas "Meta Ads" e "Google Ads": mexer numa mexia na outra.
--   Esta migration adiciona a coluna `canal` ('meta' | 'google') e passa a PK para
--   (mes, canal), separando a meta de cada página. As linhas existentes viram canal='meta'
--   (preserva a meta atual na página Meta Ads; Google começa em branco).
--
--   Também adiciona a policy de DELETE que faltava — hoje a remoção da meta era negada pela
--   RLS. O frontend passou a ZERAR a meta (upsert investimento_meta=0) em vez de apagar a
--   linha, mas a policy fica aqui por consistência/limpeza manual.

-- 1. Coluna de canal. Default 'meta' para as linhas já existentes ficarem na página Meta Ads.
alter table public.captacao_config
  add column if not exists canal text not null default 'meta';

-- Só aceita os dois canais conhecidos.
alter table public.captacao_config
  drop constraint if exists captacao_config_canal_chk;
alter table public.captacao_config
  add constraint captacao_config_canal_chk check (canal in ('meta', 'google'));

-- 2. PK composta (mes, canal). Troca a PK antiga que era só (mes).
alter table public.captacao_config
  drop constraint if exists captacao_config_pkey;
alter table public.captacao_config
  add constraint captacao_config_pkey primary key (mes, canal);

-- 3. Policy de DELETE (faltava): mesma trava de escrita das demais (admin OU crm_editor).
drop policy if exists "captacao_config_delete" on public.captacao_config;
create policy "captacao_config_delete" on public.captacao_config
  for delete to authenticated using (public.has_crm_access(auth.uid()));

notify pgrst, 'reload schema';
