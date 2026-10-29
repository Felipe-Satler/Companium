-- =====================================================================================
-- FIX (28/08/2026): restaura o GRANT SELECT perdido em `v_clientes_lookup`.
--
-- Sintoma: o planejado (Real · Planejado) sumiu do CRM (nem preencher nem visualizar) E o
-- seletor de "usuário-cliente" na Administração ficou vazio. Ambos leem `v_clientes_lookup`.
--
-- Causa: o role `authenticated` tinha TODOS os privilégios na view MENOS **SELECT** (todas as
-- outras views — v_kommo_crm_agg, v_meta_google_ads, v_cliente_especialidades — têm SELECT).
-- Sob RLS real (SET ROLE authenticated) a leitura dava `42501 permission denied for view
-- v_clientes_lookup`. Como o postgres (dono, bypassrls) enxergava as linhas, o problema só
-- aparecia com a sessão do browser. No `useClientesMetas` o fetch de v_clientes_lookup ia
-- junto no Promise.all do de clientes_meta, então a falha zerava até a visualização agregada.
--
-- A view já é escopada no próprio WHERE (is_approved + caller_client_ids); conceder SELECT é
-- seguro e alinha com todas as outras views (não-aprovado/anon recebe 0 linhas).
-- Idempotente.
-- =====================================================================================

grant select on public.v_clientes_lookup to authenticated;

notify pgrst, 'reload schema';
