-- Planejado de PROCEDIMENTOS (agendado + realizado) por cliente × mês.
--
-- Espelha as colunas de consulta (consulta_agendada / consulta_realizada): são metas
-- ABSOLUTAS (count), rateadas por cobertura de dias no frontend, e editadas inline nos
-- cards de Procedimentos da tela /clientes/crm (MetaSlot). Backward-compatible: colunas
-- novas nascem NULL (= sem planejado), o upsert por (client_id, mes, medico) segue igual.
--
-- Projeto: companium-db (produção). Aplicar ANTES de subir o frontend (o SELECT do
-- useClientesMetas já lê procedimento_agendado / procedimento_realizado).

alter table public.clientes_meta
  add column if not exists procedimento_agendado  real,
  add column if not exists procedimento_realizado real;

notify pgrst, 'reload schema';
