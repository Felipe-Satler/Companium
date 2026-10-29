-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor.
--
-- Projetos › Cronograma: ESCRITA liberada p/ TODA A EQUIPE GROOHUB (usuário interno),
-- não só admin. Antes (20260827b) insert/update/delete exigiam has_role('admin'); agora
-- basta o chamador NÃO ser usuário-cliente — ou seja, sem vínculo em user_client_scope
-- (cardinality(caller_client_ids()) = 0). Admins seguem podendo (também não têm vínculo).
-- LEITURA continua aberta a todo authenticated.
--
-- Cliente-externo (com vínculo em user_client_scope) fica BLOQUEADO de escrever, mesmo
-- que a página já seja inacessível a ele no front (rota /clientes/cronograma redireciona).
--
-- Idempotente: recria as policies. Rode DEPOIS do 20260827_projetos_cronograma_*.sql
-- (substitui o 20260827b_*_admin_write.sql).

do $$
declare t text;
begin
  foreach t in array array[
    'projetos_cronograma_meses',
    'projetos_cronograma_marcos',
    'projetos_cronograma_cards'
  ] loop
    execute format('drop policy if exists "%s_read"   on public.%I', t, t);
    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete" on public.%I', t, t);

    -- leitura: todo authenticated
    execute format('create policy "%s_read" on public.%I for select to authenticated using (true)', t, t);
    -- escrita: equipe interna (não usuário-cliente)
    execute format('create policy "%s_insert" on public.%I for insert to authenticated with check (cardinality(public.caller_client_ids()) = 0)', t, t);
    execute format('create policy "%s_update" on public.%I for update to authenticated using (cardinality(public.caller_client_ids()) = 0) with check (cardinality(public.caller_client_ids()) = 0)', t, t);
    execute format('create policy "%s_delete" on public.%I for delete to authenticated using (cardinality(public.caller_client_ids()) = 0)', t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
