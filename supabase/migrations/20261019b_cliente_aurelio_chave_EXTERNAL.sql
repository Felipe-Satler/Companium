-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto. IDEMPOTENTE.
--
-- ⚠️ RODAR JUNTO DO DEPLOY que traz o alias "Aurelio" em shared/client-aliases.js (pode ser antes:
-- sem o deploy, nada lê a chave nova; depois do deploy, nada lê a antiga).
--
-- ----------------------------------------------------------------------------------------------
-- DR. AURELIO — a chave do cliente passa de "aurelio" para "aurelio_oliveira".
--
-- A planilha de projetos chama o cliente só de "Dr. Aurelio". A chave derivada daí ("aurelio") não
-- casava com a das contas de anúncio e do CRM ("aurelio_oliveira"), e a Central de Clientes e o
-- Composer mostravam o cliente sem número e sem criativo. O alias novo faz a planilha também virar
-- "aurelio_oliveira" — e o que já foi gravado com a chave antiga precisa acompanhar, senão o resumo,
-- os relatórios e as composições dele somem do card.
-- ----------------------------------------------------------------------------------------------

-- Resumo: `cliente` é a chave primária. Só move se ainda não houver um com a chave nova; se houver
-- os dois, o antigo é descartado (o próximo resumo semanal reescreve o de agora de qualquer jeito).
update public.marketing_client_briefs set cliente = 'aurelio_oliveira'
 where cliente = 'aurelio'
   and not exists (select 1 from public.marketing_client_briefs where cliente = 'aurelio_oliveira');
delete from public.marketing_client_briefs where cliente = 'aurelio';

update public.marketing_client_reports  set cliente = 'aurelio_oliveira' where cliente = 'aurelio';
update public.marketing_compositions    set cliente = 'aurelio_oliveira' where cliente = 'aurelio';
update public.marketing_orquestracoes   set cliente = 'aurelio_oliveira' where cliente = 'aurelio';
update public.marketing_client_docs     set cliente = 'aurelio_oliveira' where cliente = 'aurelio';
update public.marketing_client_doc_pages set cliente = 'aurelio_oliveira' where cliente = 'aurelio';
update public.ad_spy_criativos          set cliente = 'aurelio_oliveira' where cliente = 'aurelio';

-- Conferência (tudo zero depois de rodar):
-- SELECT 'briefs', count(*) FROM public.marketing_client_briefs WHERE cliente = 'aurelio'
-- UNION ALL SELECT 'reports', count(*) FROM public.marketing_client_reports WHERE cliente = 'aurelio'
-- UNION ALL SELECT 'compositions', count(*) FROM public.marketing_compositions WHERE cliente = 'aurelio'
-- UNION ALL SELECT 'orquestracoes', count(*) FROM public.marketing_orquestracoes WHERE cliente = 'aurelio'
-- UNION ALL SELECT 'docs', count(*) FROM public.marketing_client_docs WHERE cliente = 'aurelio'
-- UNION ALL SELECT 'doc_pages', count(*) FROM public.marketing_client_doc_pages WHERE cliente = 'aurelio'
-- UNION ALL SELECT 'criativos', count(*) FROM public.ad_spy_criativos WHERE cliente = 'aurelio';
