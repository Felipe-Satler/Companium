-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor.
--
-- Projetos › Cronograma: ESCRITA só p/ ADMIN. Antes as policies liberavam escrita a todo
-- authenticated; agora insert/update/delete exigem `public.has_role(auth.uid(),'admin')`
-- (mesmo helper usado no resto do sistema). LEITURA continua aberta a todo authenticated —
-- não-admin vê o cronograma (só o planejado; o front esconde os cards "Real").
--
-- Idempotente: recria as policies. Rode DEPOIS do 20260827_projetos_cronograma_*.sql.

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
    -- escrita: só admin
    execute format('create policy "%s_insert" on public.%I for insert to authenticated with check (public.has_role(auth.uid(), ''admin''))', t, t);
    execute format('create policy "%s_update" on public.%I for update to authenticated using (public.has_role(auth.uid(), ''admin'')) with check (public.has_role(auth.uid(), ''admin''))', t, t);
    execute format('create policy "%s_delete" on public.%I for delete to authenticated using (public.has_role(auth.uid(), ''admin''))', t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
