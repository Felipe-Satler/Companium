-- Metas por cliente × MÊS (projeto companium-db / companium).
--
-- Contexto: a tabela `clientes_meta` já existia com uma única linha por cliente e
-- colunas únicas de investimento/cpl/leads. O dashboard precisa de:
--   1. dimensão temporal: 1 linha por (cliente, mês) — cada mês tem sua meta, e um
--      mês novo abre zerado para ser preenchido;
--   2. metas de investimento/leads/cpl SEPARADAS por fonte (Meta vs Google), pois os
--      cards de Meta Ads e Google Ads são por fonte.
--
-- O valor gravado é SEMPRE o alvo do MÊS INTEIRO. O frontend rateia os valores
-- ABSOLUTOS (investimento, leads, consultas, faturamento) por cobertura de dias quando
-- o período filtrado é menor que o mês (dia/semana). TAXAS (cpl, roas, taxa_agendamento)
-- NÃO são rateadas — um CPL-alvo de R$15 vale R$15 para qualquer recorte.
--
-- Escrita pelo frontend como `authenticated` (mesmo modelo de crm_faturamento_config):
-- a meta vale para todas as contas. Leitura idem.

-- 1. Dimensão temporal + colunas por fonte ---------------------------------------------
alter table public.clientes_meta
  add column if not exists mes                 date,
  add column if not exists investimento_meta   real,
  add column if not exists investimento_google real,
  add column if not exists leads_meta          real,
  add column if not exists leads_google        real,
  add column if not exists cpl_meta            real,
  add column if not exists cpl_google          real;

-- Linhas legadas (sem mês) → mês atual, para satisfazer o NOT NULL. Não-destrutivo:
-- mantém as colunas antigas (investimento/cpl/leads/taxa_agendamento/vendas) intactas;
-- o frontend novo usa apenas as colunas por fonte + consulta_agendada/realizada/
-- faturamento/roas. (client_id distintos → não colidem no índice único abaixo.)
update public.clientes_meta
   set mes = date_trunc('month', current_date)::date
 where mes is null;

alter table public.clientes_meta
  alter column mes set not null;

-- Uma meta por cliente por mês.
create unique index if not exists clientes_meta_client_mes_uidx
  on public.clientes_meta (client_id, mes);

-- 2. RLS: acesso total para authenticated (espelha crm_faturamento_config) --------------
alter table public.clientes_meta enable row level security;

drop policy if exists clientes_meta_read   on public.clientes_meta;
drop policy if exists clientes_meta_insert on public.clientes_meta;
drop policy if exists clientes_meta_update on public.clientes_meta;

create policy clientes_meta_read   on public.clientes_meta for select to authenticated using (true);
create policy clientes_meta_insert on public.clientes_meta for insert to authenticated with check (true);
create policy clientes_meta_update on public.clientes_meta for update to authenticated using (true) with check (true);

-- 3. View de lookup slug↔id para o frontend --------------------------------------------
-- O dashboard identifica cliente por SLUG canônico (Kommo/Ads), mas clientes_meta.client_id
-- é uuid → clientes.id. A tabela `clientes` tem RLS sem policy de select (bloqueada p/
-- authenticated), então expomos uma view gated por is_approved (igual a
-- v_cliente_especialidades) com (id, nome_identificador, nome_bruto) p/ casar nome→id.
create or replace view public.v_clientes_lookup as
  select c.id,
         c.nome_identificador,
         cc.nome_bruto
    from public.clientes c
    left join public.cliente_contas cc
      on cc.cliente_id = c.id and cc.ativo = true
   where c.ativo = true
     and is_approved(auth.uid());

grant select on public.v_clientes_lookup to authenticated;
