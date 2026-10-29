-- Planejado por MÉDICO — exclusivo da Lia Garrido; demais clientes continuam usando
-- medico='' (planejado geral). A tela de CRM grava/lê o planejado do médico filtrado
-- (useClientesMetas + medicoScope em ClientesCRM). Backward-compatible: toda linha
-- existente recebe medico='' e a constraint única passa a incluir a coluna, então o
-- upsert dos outros clientes (onConflict "client_id,mes,medico" com medico='') segue igual.
-- Projeto: companium-db (produção). Aplicar ANTES de subir o frontend (o SELECT já lê `medico`).

alter table public.clientes_meta
  add column if not exists medico text not null default '';

-- Troca a unicidade (client_id, mes) → (client_id, mes, medico).
do $$
begin
  if exists (
    select 1 from pg_constraint where conrelid = 'public.clientes_meta'::regclass
      and conname = 'clientes_meta_client_mes_key'
  ) then
    alter table public.clientes_meta drop constraint clientes_meta_client_mes_key;
  end if;

  if not exists (
    select 1 from pg_constraint where conrelid = 'public.clientes_meta'::regclass
      and conname = 'clientes_meta_client_mes_medico_key'
  ) then
    alter table public.clientes_meta
      add constraint clientes_meta_client_mes_medico_key unique (client_id, mes, medico);
  end if;
end $$;

notify pgrst, 'reload schema';
