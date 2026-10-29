-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- ⚠️ RODAR ANTES DO RESTART DO WORKER: o worker novo lê e grava esta tabela na aba Brand kit da
-- Central de Clientes. Sem ela, a aba responde 502.
--
-- ----------------------------------------------------------------------------------------------
-- MARKETING › CENTRAL DE CLIENTES › BRAND KIT — o que uma arte estática PODE usar de um cliente.
--
-- Cores (primária, secundária, terciária), fontes, logo, contatos, endereços e a identificação do
-- médico (nome, CRM/UF, RQE). Se cada elemento entra numa arte é decisão da criação do estático,
-- não daqui: nenhuma coluna é obrigatória além do cliente.
--
-- Uma linha por cliente (upsert por `cliente`), como os resumos. O histórico de paletas não é
-- guardado: substituir a paleta fixa pede confirmação na tela, e é essa a proteção.
--
-- As imagens moram no bucket privado `ad-spy-media`, sob `brand-kits/{cliente}/`; aqui só o caminho.
-- ----------------------------------------------------------------------------------------------

create table if not exists public.marketing_brand_kits (
  -- O `padrao` do cliente, a MESMA chave dos resumos e das composições. Sem FK: a lista de ativos
  -- vem de `projetos_lista`, que é planilha.
  cliente         text primary key,
  nome_clinica    text,
  -- { primaria, secundaria, terciaria }: "#RRGGBB" ou null. Validado pelo worker
  -- (`shared/brand-kit.js`), não por CHECK — a forma mora no código, com a tela.
  paleta          jsonb not null default '{}'::jsonb,
  -- { titulo, texto }: famílias do Google Fonts da lista curada.
  fontes          jsonb not null default '{}'::jsonb,
  -- { whatsapp, telefone, instagram, site, email }
  contatos        jsonb not null default '{}'::jsonb,
  -- [{ rotulo, linha }], até 5 — há clínica com mais de uma unidade.
  enderecos       jsonb not null default '[]'::jsonb,
  -- { nome, crm, uf, rqe, pos_graduacao }. É a fonte da identificação na arte: o Estudo de Copy
  -- também a traz, mas é aqui que alguém confere antes de ela ir para uma peça publicada.
  identificacao   jsonb not null default '{}'::jsonb,
  -- A bio do Instagram do cliente tem nome, CRM/UF, "MÉDICO" e RQE. É o que deixa a identificação
  -- OPCIONAL na arte de feed orgânico (Res. CFM 2.336/2023); sem a conferência, ela é obrigatória.
  bio_conferida   boolean not null default false,
  -- { logo, logo_escuro, foto_medico }: caminhos no bucket. Escritos só pelo worker no upload.
  imagens         jsonb not null default '{}'::jsonb,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid
);

comment on table public.marketing_brand_kits is
  'Marketing › Central de Clientes › Brand kit: cores, fontes, logo, contatos, endereços e a '
  'identificação do médico que as artes estáticas podem usar. Uma linha por cliente. Escrita pelo '
  'worker (service_role).';

alter table public.marketing_brand_kits enable row level security;

-- Leitura: equipe interna aprovada, a mesma regra de `marketing_compositions`. Escrita sem policy:
-- passa pelo worker com service_role.
drop policy if exists marketing_brand_kits_read on public.marketing_brand_kits;
create policy marketing_brand_kits_read on public.marketing_brand_kits
  for select to authenticated
  using (is_approved(auth.uid()) and (select public.caller_ads_names()) is null);

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT to_regclass('public.marketing_brand_kits');
-- SELECT cliente, nome_clinica, paleta, identificacao->>'crm' AS crm, atualizado_em
--   FROM public.marketing_brand_kits ORDER BY atualizado_em DESC LIMIT 10;
