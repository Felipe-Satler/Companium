-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo. É ADITIVO: cria UMA tabela nova,
-- não toca em nenhum dado/vista existente.
--
-- CORREÇÃO MANUAL dos números do CRM (Leads / Consultas agendadas & realizadas /
-- Procedimentos agendados & realizados) POR VIEW FILTRADO. O valor gravado SUBSTITUI o
-- calculado e fica FIXO naquele recorte (regra "sempre fixo"), até ser removido.
--
--  • CHAVE (`filter_sig`): o FILTRO INTEIRO que afeta os totais dos cards
--    (cliente + médico + origem + período NORMALIZADO). Assim a correção só se aplica
--    exatamente ao view que foi editado — nunca vaza para outro filtro. Período normalizado:
--    mês fechado → "m:AAAA-MM"; mês-até-hoje → "mtd:AAAA-MM" (estável o mês todo, não quebra
--    quando o dia vira); range custom → "r:de_ate".
--
--  • LEITURA: liberada p/ authenticated — TODO MUNDO vê o número corrigido (inclusive quem
--    não pode editar). PORÉM usuário-cliente (acesso restrito) só enxerga o override do
--    PRÓPRIO cliente, via policy RESTRICTIVE com scope_kommo_ok() (mesma trava das views do
--    CRM). O agregado "todos" (client_scope='__ALL__') nunca casa com o vínculo dele → some.
--
--  • ESCRITA: só admin OU papel `crm_editor` (has_crm_access) — idêntico a clientes_meta /
--    crm_faturamento_config. A UI ainda esconde os controles p/ os demais, mas a trava REAL
--    é esta RLS.

create table if not exists public.crm_metric_overrides (
  id           uuid primary key default gen_random_uuid(),
  filter_sig   text not null,
  metric       text not null check (metric in (
                 'leads',
                 'consultas_agendadas', 'consultas_realizadas',
                 'procedimentos_agendados', 'procedimentos_realizados')),
  value        numeric not null,
  -- Contexto legível (auditoria) + escopo. client_scope guarda o slug CRU do cliente
  -- (ou '__ALL__' p/ o agregado); scope_kommo_ok() normaliza com client_matchkey no banco.
  client_scope text not null default '__ALL__',
  medico_scope text not null default '',
  origem       text not null default '',
  period_kind  text not null default '',
  period_from  date,
  period_to    date,
  period_label text not null default '',
  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  unique (filter_sig, metric)
);

alter table public.crm_metric_overrides enable row level security;

-- LEITURA base: todo authenticated (o número corrigido tem que aparecer p/ qualquer um).
drop policy if exists crm_overrides_read on public.crm_metric_overrides;
create policy crm_overrides_read on public.crm_metric_overrides
  for select to authenticated using (true);

-- LEITURA escopada (RESTRICTIVE = AND por cima): equipe (sem vínculo) → scope_kommo_ok = TRUE
-- (vê tudo). Usuário-cliente → só linhas cujo client_scope casa com o cliente dele; o
-- agregado '__ALL__' e os outros clientes ficam invisíveis. Depende de scope_kommo_ok()
-- e client_matchkey(), criadas na migration 20260730b (usuário-cliente escopo).
drop policy if exists crm_overrides_client_scope on public.crm_metric_overrides;
create policy crm_overrides_client_scope on public.crm_metric_overrides
  as restrictive for select to authenticated
  using (public.scope_kommo_ok(client_scope));

-- ESCRITA: só admin / crm_editor (has_crm_access), criada na migration 20260727.
drop policy if exists crm_overrides_insert on public.crm_metric_overrides;
drop policy if exists crm_overrides_update on public.crm_metric_overrides;
drop policy if exists crm_overrides_delete on public.crm_metric_overrides;

create policy crm_overrides_insert on public.crm_metric_overrides
  for insert to authenticated with check (public.has_crm_access(auth.uid()));
create policy crm_overrides_update on public.crm_metric_overrides
  for update to authenticated
  using (public.has_crm_access(auth.uid())) with check (public.has_crm_access(auth.uid()));
create policy crm_overrides_delete on public.crm_metric_overrides
  for delete to authenticated using (public.has_crm_access(auth.uid()));

notify pgrst, 'reload schema';
