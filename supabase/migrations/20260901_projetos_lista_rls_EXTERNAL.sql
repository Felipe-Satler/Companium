-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium). Rode no SQL Editor
-- desse projeto. Aplicar ANTES de subir o frontend novo.
--
-- LEITURA DE `projetos_lista` (planilha de projetos sincronizada):
--   A tabela está com RLS LIGADA e NENHUMA policy. Nesse estado o Postgres nega tudo, mesmo
--   com o GRANT SELECT que `authenticated` já tem — ou seja, o dashboard logado hoje lê ZERO
--   linhas (sem erro: devolve lista vazia). É por isso que a tela de Metas mostraria todos os
--   clientes sem squad mesmo com a tabela cheia.
--
--   Esta migration cria a policy de LEITURA para usuário logado. A sincronização da planilha
--   continua funcionando sem mudança: ela escreve com service_role, que ignora RLS.

-- Leitura p/ qualquer usuário autenticado. A tabela é cadastro interno (cliente, plano,
-- líder de RevOps, data de início) — sem dado sensível de terceiros — e a tela que a consome
-- (Clientes › Metas) já é restrita à equipe/liberação explícita (papel metas_viewer).
drop policy if exists "projetos_lista_select_authenticated" on public.projetos_lista;
create policy "projetos_lista_select_authenticated"
  on public.projetos_lista
  for select
  to authenticated
  using (true);

-- NADA de policy p/ `anon`: sem sessão, ninguém lê. E como não existe policy de INSERT/UPDATE/
-- DELETE p/ nenhum papel, a tabela segue somente-leitura pela API — só o service_role (sync)
-- escreve.

-- OPCIONAL (higiene, NÃO aplicado aqui p/ não arriscar quebrar a rotina de sync): `anon` e
-- `authenticated` receberam GRANT de INSERT/UPDATE/DELETE/TRUNCATE nesta tabela. Hoje a RLS
-- neutraliza esses grants, mas eles passariam a valer se algum dia alguém criar uma policy
-- permissiva de escrita. Se a sincronização não usa nenhum desses papéis, dá p/ revogar:
--
--   revoke insert, update, delete, truncate on public.projetos_lista from anon, authenticated;
--   revoke all on public.projetos_lista from anon;

notify pgrst, 'reload schema';
