# Companium

Plataforma interna de analytics e operação que desenvolvi na **Groohub**, uma assessoria de marketing e vendas para médicos e clínicas. Ela junta em um só lugar os dados de mídia paga, CRM e gestão da carteira de clientes, e traz ferramentas de IA para o time de marketing.

> Os nomes de clientes, pessoas, contas de anúncio e identificadores de infraestrutura deste repositório são **fictícios**. Nenhum dado real de cliente está incluído.

## O que tem dentro

- **Clientes**: visão por cliente com Meta Ads, Google Ads e CRM (Kommo) lado a lado, funil de leads até procedimento, metas mensais e cronograma de projetos.
- **Captação**: investimento real, pacing mensal e metas da mídia própria da agência.
- **Gestão**: MRR, churn, tempo de casa e evolução por squad, a partir da planilha de gestão.
- **Marketing com IA**: mineração de anúncios de concorrentes (Biblioteca da Meta, TikTok, Instagram), análise de criativos, composer de copys a partir do estudo de copy do cliente e geração de artes.
- **Assistente**: chat com agentes de IA, gráficos gerados na conversa e agente para grupos de WhatsApp.
- **Administração**: aprovação de usuários, papéis por área e escopo de acesso por cliente via RLS.

## Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind, shadcn/ui, TanStack Query, Recharts |
| Backend | Supabase (Postgres, Auth, RLS, Storage), serviços Node/Express em `apps/` |
| Dados | Meta Ads, Google Ads e Kommo CRM, com ingestão via n8n |
| IA e automação | Agentes OpenClaw, Playwright para scraping, Whisper para transcrição |
| Qualidade | Vitest + Testing Library, com mais de 1.400 testes automatizados |
| Deploy | Nginx + systemd em VPS, com deploy automático por timer |

## Estrutura

```
src/          frontend (páginas, componentes, hooks, chatbot)
shared/       regras de negócio em JS puro, usadas pelo front e pelos workers
apps/         serviços de backend: ad-spy-worker, openclaw-bridge, whatsapp-agent, whatsapp-admin, gestao-proxy
supabase/     migrations (tabelas, views, RLS)
```

## Rodando localmente

```bash
cp .env.example .env.local   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev
npm test
```

## Como foi feito

O código foi escrito com ferramentas de IA (Lovable e Claude Code). A definição do que construir, as decisões de arquitetura e de dados, a validação dos números contra as plataformas de anúncio e os testes de cada funcionalidade foram feitos por mim.

---

Desenvolvido por **Felipe Satler** · Groohub, 2026
