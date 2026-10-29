-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES (ou junto) de subir o frontend novo.
--
-- TELA GESTÃO › MARCOS (metas mensais x realizado):
--   Tabela `marcos_metas` — SÓ o PLANEJADO (meta) de cada indicador por mês. O realizado
--   NÃO mora aqui: vem inteiro da tela Gestão (useGestaoBI). Uma linha por
--   (indicador, mês). Campo vazio na tela => a linha é APAGADA (nunca grava zero).
--
--   indicador ∈ {mrr, ativos, nmrr, novos, nmrrTicket, revChurn} (chaves de GRUPOS_MARCOS).
--   mes no formato 'AAAA-MM'. valor = meta (numeric; moeda/contagem/percentual conforme o indicador).
--
--   LEITURA e ESCRITA abertas a todo authenticated — a tela já é restrita no app
--   (rota /gestao/marcos protegida por GestaoRoube: só o dono e quem ele liberou).
--   Para travar a escrita só p/ admin OU crm_editor, troque o `using/with check (true)`
--   das políticas de insert/update/delete por `public.has_crm_access(auth.uid())`
--   (mesmo helper do planejado do CRM / captacao_metas).

create table if not exists public.marcos_metas (
  indicador      text        not null,
  mes            text        not null,            -- 'AAAA-MM'
  valor          numeric     not null,
  atualizado_por text,
  atualizado_em  timestamptz not null default now(),

  primary key (indicador, mes),
  constraint marcos_metas_indicador_chk
    check (indicador in ('mrr', 'ativos', 'nmrr', 'novos', 'nmrrTicket', 'revChurn')),
  constraint marcos_metas_mes_fmt check (mes ~ '^\d{4}-\d{2}$')
);

alter table public.marcos_metas enable row level security;

drop policy if exists "marcos_metas_read"   on public.marcos_metas;
drop policy if exists "marcos_metas_insert" on public.marcos_metas;
drop policy if exists "marcos_metas_update" on public.marcos_metas;
drop policy if exists "marcos_metas_delete" on public.marcos_metas;

create policy "marcos_metas_read" on public.marcos_metas
  for select to authenticated using (true);
create policy "marcos_metas_insert" on public.marcos_metas
  for insert to authenticated with check (true);
create policy "marcos_metas_update" on public.marcos_metas
  for update to authenticated using (true) with check (true);
create policy "marcos_metas_delete" on public.marcos_metas
  for delete to authenticated using (true);

notify pgrst, 'reload schema';
