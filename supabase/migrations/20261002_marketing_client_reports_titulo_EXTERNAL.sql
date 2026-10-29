-- ⚠️ PROJETO-ALVO: your-project-ref (Supabase EXTERNO / companium), NÃO o projeto
-- primário do config.toml. Rode este SQL no SQL Editor DESSE projeto (o PAT é read-only, então DDL
-- só passa pelo SQL Editor). IDEMPOTENTE.
--
-- Pode rodar ANTES ou DEPOIS do deploy do worker, e sem pressa: é uma coluna aditiva e nula. O
-- worker antigo a ignora; o worker novo grava `null` enquanto ela não existir? **Não** — sem a
-- coluna, um POST com `titulo` responde 400 e a geração de relatório para. Então rode antes do
-- restart.
--
-- ----------------------------------------------------------------------------------------------
-- RELATÓRIO: um NOME dado pela pessoa.
--
-- O histórico identificava cada relatório por `periodo_label` ("Setembro de 2026"). Isso basta
-- enquanto há um relatório por período, e deixa de bastar no uso real: gera-se mais de um do mesmo
-- mês com focos diferentes ("só a campanha de vídeo", "depois que trocamos a oferta"), e aí a lista
-- fica com três linhas idênticas e a pessoa abre uma por uma para lembrar qual é qual.
--
-- É `text` nulo e não `not null default ''` porque "sem nome" é um estado legítimo e precisa ser
-- distinguível de "nomeado com string vazia": a tela cai para o rótulo do período quando é nulo, e
-- esse fallback só funciona se o nulo chegar até ela.
-- ----------------------------------------------------------------------------------------------

alter table public.marketing_client_reports
  add column if not exists titulo text;

comment on column public.marketing_client_reports.titulo is
  'Nome dado pela pessoa ao relatório, opcional. NULO = sem nome, e a tela cai para `periodo_label`. '
  'Existe porque mais de um relatório do mesmo período com focos diferentes ficava indistinguível '
  'no histórico.';

notify pgrst, 'reload schema';

-- Conferência:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'marketing_client_reports' AND column_name = 'titulo';
