-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ----------------------------------------------------------------------------------------------
-- ESPECIALIDADES PARA O WORKER — a mesma leitura de `v_cliente_especialidades`, sem o portão.
--
-- ## O problema
--
-- `v_cliente_especialidades` termina com `is_approved(auth.uid())`. Isso é um WHERE dentro da
-- definição da VIEW, e predicado de view NÃO é RLS: ninguém passa por cima dele, nem o
-- `service_role`, porque com ele não existe `auth.uid()`. Resultado: a view volta ZERO linhas para
-- o ad-spy-worker, **sem erro nenhum**, e todo Contexto Operacional nasce sem especialidade — a
-- informação que orienta quem nunca mexeu no cliente.
--
-- ## Por que uma função, e não ler `clientes` direto
--
-- O worker poderia ler a tabela (service_role ignora RLS de tabela). Descartado: duplicaria o
-- desempacotamento do jsonb e os filtros num segundo lugar, e no dia em que a view mudasse as duas
-- leituras divergiriam em silêncio. Aqui a lógica fica em UM lugar, espelhando a view.
--
-- ## O que muda em relação à view, e o que NÃO muda
--
-- Sai: `is_approved(auth.uid())` (é o ponto) e o `LEFT JOIN cliente_contas`, que só servia para
-- `nome_bruto` — coluna que o worker não lê. Sem o join, sai UMA linha por cliente em vez de uma por
-- conta ativa.
--
-- Fica idêntico: `c.ativo`, `especialidade IS NOT NULL`, o teste de `jsonb_typeof(... ) = 'object'` e
-- o desempacotamento pelos VALORES do objeto. Valor vazio também continua passando, como na view —
-- quem limpa é o `filter(Boolean)` do prompt (`briefs-prompt.js`). Filtrar aqui faria a função deixar
-- de ser espelho, que é a única coisa que a torna confiável.
--
-- ## ⚠️ O GRANT é o que decide se isto é seguro
--
-- `SECURITY DEFINER` ignora o portão. Se `authenticated` puder executar, qualquer usuário-cliente
-- logado lê a especialidade da carteira inteira — exatamente o que o `is_approved()` da view existe
-- para impedir. Por isso o REVOKE de `public` (que ganha EXECUTE por padrão em função nova) e o
-- EXECUTE só para `service_role`, que só existe no `spy.env` do servidor e nunca no browser.
-- ----------------------------------------------------------------------------------------------

create or replace function public.especialidades_clientes_worker()
returns table (nome_identificador text, especialidades text[])
language sql
stable
security definer
-- `search_path` fixo: sem isto, um schema no caminho do chamador poderia sequestrar `clientes` ou
-- `jsonb_each_text` dentro de uma função que roda como owner.
set search_path = public
as $$
  select
    c.nome_identificador::text,
    array(
      select v.value
      from jsonb_each_text(c.especialidade -> 'especialidades') as v(key, value)
    ) as especialidades
  from public.clientes c
  where c.ativo = true
    and c.especialidade is not null
    and jsonb_typeof(c.especialidade -> 'especialidades') = 'object';
$$;

comment on function public.especialidades_clientes_worker() is
  'Especialidades por cliente ativo para o ad-spy-worker: o mesmo conteúdo de '
  'v_cliente_especialidades sem o predicado is_approved(auth.uid()), que zera a view para '
  'service_role (predicado de view não é RLS). NUNCA conceda EXECUTE a authenticated/anon: '
  'SECURITY DEFINER ignora o portão, e um usuário-cliente leria a carteira inteira.';

-- Toda função nova nasce com EXECUTE para PUBLIC. Tirar isso é o passo que importa.
revoke all on function public.especialidades_clientes_worker() from public;
revoke all on function public.especialidades_clientes_worker() from anon;
revoke all on function public.especialidades_clientes_worker() from authenticated;
grant execute on function public.especialidades_clientes_worker() to service_role;

notify pgrst, 'reload schema';

-- Conferência:
-- 1) A função devolve linhas (rode como service_role / no SQL Editor):
--    SELECT count(*) FROM public.especialidades_clientes_worker();
-- 2) E devolve o MESMO conjunto de clientes que a view, sem duplicar por conta:
--    SELECT count(DISTINCT nome_identificador) FROM public.v_cliente_especialidades;  -- como equipe
--    SELECT count(*) FROM public.especialidades_clientes_worker();                    -- deve bater
-- 3) O grant está fechado (não deve aparecer authenticated nem PUBLIC):
--    SELECT grantee, privilege_type FROM information_schema.routine_privileges
--     WHERE routine_name = 'especialidades_clientes_worker';
