# Agente de IA no WhatsApp (grupos) — runbook de ativação

Feature: um agente OpenClaw conectado a um número de WhatsApp que responde em **grupos**,
configurável por uma tela admin no Companium (**Administração › Agente WhatsApp**, `/admin/whatsapp`).

**Desenho de segurança (já embutido):**
- Nasce **DESLIGADO** e **sem grupos**. Nada responde até alguém conectar o WhatsApp e habilitar.
- Padrão: **só responde quando mencionado** (`require_mention=true`) e **só em grupos liberados** (allowlist).
- Acesso à tela: **admin OU** quem o admin liberar com o papel **`whatsapp_editor`** (botão "Agente
  WhatsApp" no painel /admin, por usuário). Não aparece para as demais contas. A mesma regra protege o
  banco (RLS via `public.has_whatsapp_access`).
- Config vive no Supabase (`whatsapp_group_agents`). A tela nunca fala direto com o
  gateway — quem aplica é o serviço `whatsapp-agent-sync` (service_role), evitando expor o gateway ao front.
- O agente roda com **`tools.deny: ["*"]`** (sem banco/arquivo/web/exec): responde só com texto.

---

## Pré-requisitos (uma vez)

### 1) Aplicar as migrations no Supabase (companium-db)
O PAT é read-only (DDL dá 403), então rode no **SQL Editor** do projeto `your-project-ref`, **nesta ordem**:
```
companium/supabase/migrations/20261026_whatsapp_group_agents_EXTERNAL.sql
companium/supabase/migrations/20261026b_whatsapp_group_insights_EXTERNAL.sql
```
- A 1ª cria `whatsapp_group_agents` + `whatsapp_known_groups` + RLS admin-only + 1 linha semente (desligada).
- A 2ª cria `whatsapp_group_insights` (acompanhamento: sentimento + andamento do atendimento por grupo), RLS admin-only. **Depende** da 1ª (reusa `public.has_whatsapp_access`).
> ⚠️ A 1ª migration tem `alter type public.app_role add value ...`. Se o SQL Editor reclamar de
> transação ("ALTER TYPE ... ADD VALUE cannot run inside a transaction block"), rode **essa linha
> sozinha** primeiro e depois o resto do arquivo.

### 2) Instalar o plugin de WhatsApp do OpenClaw (precisa sudo)
```bash
sudo npm i -g @openclaw/whatsapp
```

### 3) Criar o agente dedicado (inerte até o canal ligar)
```bash
openclaw agents add whatsappagent --non-interactive \
  --workspace /home/deploy/.openclaw/workspace-whatsappagent \
  --agent-dir /home/deploy/.openclaw/agents/whatsappagent/agent \
  --model gpt-6-astra \
  --bind whatsapp:whatsapp-groobot --json
```
> Isso cria o agente, o workspace e a rota `{channel: whatsapp, accountId: whatsapp-groobot} -> whatsappagent`.
> O `AGENTS.md` do workspace é escrito/atualizado automaticamente pelo serviço de sync a partir do
> prompt configurado na tela. (Confira o `model` com `openclaw capability model list`; use o mesmo
> modelo da conexão de conta — hoje `gpt-6-astra`.)

### 4) Serviço whatsapp-admin (conexão/QR/status PELA TELA) + nginx
A tela Administração › Agente WhatsApp conecta/mostra status/reconecta via este serviço (não expõe
o gateway ao front). Instale (sudo):
```bash
cd /home/deploy/companium/apps/whatsapp-admin && npm ci
sudo cp whatsapp-admin.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now whatsapp-admin.service
# nginx: adicionar no server de companium.example.com (/etc/nginx/sites-available/companium.example.com):
#   location ^~ /api/whatsapp/ {
#     proxy_pass http://127.0.0.1:18920;
#     proxy_http_version 1.1;
#     proxy_set_header Authorization $http_authorization;
#     proxy_set_header Host $host;
#     proxy_buffering off;              # <- streaming do QR (SSE)
#     proxy_read_timeout 300s;
#   }
sudo nginx -t && sudo systemctl reload nginx
```
Verifique: `curl -s localhost:18920/api/whatsapp/health` → `{"ok":true}`.

### 4b) Conectar o número (QR) — PELA TELA
Use um **número dedicado** (chip só do bot). Abra a tela **Administração › Agente WhatsApp** →
card **Conexão do WhatsApp** → **Conectar (QR)**. Escaneie o QR direto da tela (WhatsApp ›
Aparelhos conectados › Conectar aparelho). O status (conectado/ativo/erro), reconexão e reinício
do gateway ficam todos nesse card. (CLI equivalente, se precisar: `openclaw channels login
--channel whatsapp`.)

⚠️ A captura do QR pela tela faz streaming da saída de `openclaw channels login` (QR em ASCII). O
formato exato só é visível com o plugin instalado — valide no 1º uso e ajuste `server.mjs` se o QR
vier em outro formato (ex.: precisar converter um código em imagem).

### 5) Instalar o serviço de sync (precisa sudo)
```bash
cd /home/deploy/companium/apps/whatsapp-agent && npm ci
sudo cp whatsapp-agent-sync.service /etc/systemd/system/
sudo cp whatsapp-agent-sync.timer   /etc/systemd/system/
# drop-in com as chaves Supabase centrais (igual aos outros serviços):
sudo mkdir -p /etc/systemd/system/whatsapp-agent-sync.service.d
printf '[Service]\nEnvironmentFile=/etc/companium-supabase.env\n' | \
  sudo tee /etc/systemd/system/whatsapp-agent-sync.service.d/zz-supabase-central.conf
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-agent-sync.timer
```

### 6) Instalar o serviço de ACOMPANHAMENTO dos grupos (sentimento/atendimento — precisa sudo)
Gera, de hora em hora, o painel **Acompanhamento dos grupos** da tela (andamento do grupo,
sentimento da conversa e andamento do atendimento). Usa a conexão de conta OpenClaw (via gateway,
SEM API paga), igual ao job de Análise IA do Meta Ads.
```bash
cd /home/deploy/companium/apps/whatsapp-agent   # já tem node_modules (passo 5)
sudo cp whatsapp-agent-insights.service /etc/systemd/system/
sudo cp whatsapp-agent-insights.timer   /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/whatsapp-agent-insights.service.d
printf '[Service]\nEnvironmentFile=/etc/companium-supabase.env\n' | \
  sudo tee /etc/systemd/system/whatsapp-agent-insights.service.d/zz-supabase-central.conf
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-agent-insights.timer
```
Validação em **dry-run** (não grava) ANTES de ligar o timer:
```bash
cd /home/deploy/companium/apps/whatsapp-agent
set -a; . /etc/companium-supabase.env; set +a
node insights.mjs            # dry-run: mostra o que gravaria por grupo
node insights.mjs --apply    # grava os snapshots em whatsapp_group_insights
```
⚠️ **1ª ativação — confirmar o comando que lista mensagens do grupo.** O `insights.mjs` usa por padrão
`openclaw directory messages list --channel whatsapp --account <conta> --group <jid> --limit N --json`.
Se o plugin expuser outro subcomando, veja `openclaw channels capabilities --channel whatsapp` e ajuste
`WHATSAPP_HISTORY_SUBCMD` (env) ou `buildHistoryArgs()` no `insights.mjs`. Enquanto o comando não casar,
o job PULA os grupos (não grava lixo) e a tela mostra "nenhum acompanhamento ainda".

---

## Validação (ANTES de ligar de verdade)
Rode o sync em **dry-run** (padrão, não escreve nada) e confira a saída:
```bash
cd /home/deploy/companium/apps/whatsapp-agent
set -a; . /etc/companium-supabase.env; set +a
node sync.mjs            # dry-run: mostra o AGENTS.md e o bloco channels.whatsapp que aplicaria
```
Depois, uma aplicação manual controlada:
```bash
node sync.mjs --apply    # escreve AGENTS.md, aplica canal, e reinicia o gateway (--safe) se mudou
```

### ⚠️ Confirmar a semântica do allowlist de grupos (1ª vez)
O bloco gerado é:
```json
{ "accounts": { "whatsapp-groobot": { "enabled": true, "groupPolicy": "allowlist", ... } },
  "groups":   { "<grupo liberado>": { "requireMention": true } } }
```
Teste em **um grupo interno** primeiro:
1. Libere só esse grupo na tela, ligue o agente, rode `node sync.mjs --apply`.
2. Mande uma mensagem **mencionando** o número → deve responder.
3. Mande uma mensagem **sem** mencionar → NÃO deve responder (se `require_mention` ligado).
4. Em um grupo **fora** da allowlist → NÃO deve responder.

Se o comportamento divergir (ex.: `requireMention` não pega sem uma entrada `"*"`, ou a allowlist usa
outro campo), ajuste `buildWhatsappChannelBlock()` em `sync.mjs` conforme o observado e documente aqui.
`openclaw channels capabilities --channel whatsapp` mostra os recursos suportados.

---

## Funções (dados CRM / Meta / ClickUp) — quando `tools_enabled` na tela
Por padrão o agente é **só texto** (`tools.deny:["*"]`). Para dar a ele as MESMAS funções dos chatbots
da Groohub (consultar CRM/Meta/Google no Supabase + ClickUp), espelhe o padrão do bot da equipe:

1. **Toolset do agente** — o agente precisa de `exec` (para o mcporter) e, se quiser, `web_search`/`web_fetch`.
   Como `agents.list` é um array, ajuste no `openclaw.json` o objeto do `whatsappagent` (ou recrie com o
   mesmo toolset do agente da equipe), p.ex.:
   ```json
   "tools": { "allow": ["exec","web_search","web_fetch"], "deny": ["write","edit","apply_patch","gateway","cron","nodes"], "elevated": { "enabled": false } }
   ```
   Depois: `openclaw gateway restart --safe`.
2. **Acesso ao banco (read-only)** — o agente usa `exec` → mcporter, SOMENTE LEITURA, igual aos bots:
   `mcporter call groohub_database execute_sql '{"query":"SELECT ..."}'` (ver [[companium_supabase_mcp_wrong_project]]:
   o usuário do MCP é read-only; nunca escreve). As instruções já vão no `AGENTS.md` gerado pelo sync.
3. **ClickUp read-only** — pelo wrapper exec-allowlisted, igual ao `briefagent` (tools.allow=["exec"] + allowlist).
4. **exec-allowlist (OBRIGATÓRIO)** — NÃO deixe `exec` livre num agente que fala em grupo. Restrinja os
   comandos permitidos (só `mcporter call groohub_database execute_sql` e o wrapper do ClickUp), como o
   briefagent faz. Sem isso, qualquer um no grupo poderia rodar comando arbitrário.

### ⚠️ Risco de vazamento entre clientes
Com funções de dados, o agente enxerga dados de TODOS os clientes (não há escopo por usuário como no
GrooChat, porque membros do grupo não são usuários autenticados do Companium). Em grupo de CLIENTE isso
pode vazar dados de outro cliente. **Recomendação:** use funções apenas em grupos INTERNOS/da equipe;
em grupos de cliente, mantenha `tools_enabled=false`. O `AGENTS.md` já tem a regra de não cruzar clientes,
mas regra de prompt não é controle forte — a trava real é onde você adiciona o número.

## Escopo de grupos: allowlist x "todos"
- `group_scope='allowlist'` → `groupPolicy:"allowlist"` + uma entrada por grupo liberado.
- `group_scope='all'` → `groupPolicy:"open"` + regra global `groups["*"]`. ⚠️ confirme na 1ª ativação que
  `"open"` é o valor que o plugin WhatsApp aceita para "responder em qualquer grupo"
  (`openclaw channels capabilities --channel whatsapp`); ajuste `buildAccount()` no `sync.mjs` se divergir.

## Operação diária
- Tudo pela tela **Administração › Agente WhatsApp**: prompt, grupos liberados, gatilho, liga/desliga.
- Ao salvar, o timer (5 min) aplica no gateway. Para aplicar na hora: `node sync.mjs --apply`.
- **Parada de emergência:** desligue o agente na tela (toggle) e rode `node sync.mjs --apply`
  (ou `openclaw config set channels.whatsapp.accounts.whatsapp-groobot.enabled false --strict-json --merge`
  e `openclaw gateway restart --safe`).
- Os grupos detectados aparecem na tela depois que o sync roda com o WhatsApp conectado.

## Troubleshooting (resolvido 27/10/2026)

**Sintoma: QR conecta no celular mas a tela mostra "desconectado".**
O QR linka de verdade (creds em `~/.openclaw/credentials/whatsapp/whatsapp-groobot`), mas o canal fica
`enabled=false` porque o `sync` só ativa quando `enabled=true` **E** (`group_scope='all'` OU há grupos na
allowlist). Como não há grupos descobertos a frio, **é preciso `group_scope='all'`** para o socket subir.
Ligue pela tela (toggle mestre + "responder em todos os grupos") e rode `node sync.mjs --apply`. Se o
`gateway restart --safe` ficar preso drenando runs, force `systemctl --user restart openclaw-gateway.service`.

**Sintoma: no grupo aparece "digitando…" mas nada é enviado.** Log do gateway mostra
`FailoverError: Unknown model: openai-codex/gpt-6-astra` → `Embedded agent failed before reply`.
O agente precisa do **agentDir com `models.json`** registrando o modelo (contextWindow 272000); se o agentDir
configurado (`~/.openclaw/agents/whatsappagent/agent/`) não existir, o modelo é "desconhecido". Fix:
```
mkdir -p ~/.openclaw/agents/whatsappagent/agent
cp ~/.openclaw/agents/relatoriomarketingagent/agent/{models.json,auth-profiles.json} \
   ~/.openclaw/agents/whatsappagent/agent/
systemctl --user restart openclaw-gateway.service
```
Garanta também que `agents.list[].model` use o alias curto `"gpt-6-astra"` (não `"openai-codex/gpt-6-astra"`).

**Sintoma: o agente faz onboarding (pede nome/vibe/emoji) em vez de responder.** O `IDENTITY.md`/`BOOTSTRAP.md`
genéricos do workspace induzem onboarding; o overlay FIXO em `buildAgentsMd` (sync.mjs) precisa ser forte o
bastante para suprimir (ver seção `## Identidade e contexto FIXO`). Reforçado em 27/10. Teste:
`openclaw agent --agent whatsappagent --session-id t1 --message "responda apenas: OK"` → deve devolver só `OK`.

**Sintoma: painel "Acompanhamento dos grupos" vazio (sem respostas/andamento/histórico).** O plugin do
WhatsApp NÃO expõe listagem de grupos nem de mensagens (`directory` só tem groups/peers/self, e `directory
groups list` vem `[]` no WhatsApp Web; `channels capabilities` não tem ação de histórico). Por isso o
`insights.mjs` foi reescrito (27/10) para ler da **sessão do agente**, não do plugin:
descobre os grupos via `openclaw sessions --agent whatsappagent --json` (filtra `kind:"group"`, extrai o
group_id da chave `...:whatsapp:group:<id>:thread:...`) e lê a conversa do arquivo de trajetória
`~/.openclaw/agents/whatsappagent/sessions/<sessionId>-topic-*.jsonl` (records `type:"message"` →
role user/assistant; metadados `Conversation info` dão `group_subject`/sender). Depois pede a análise ao
modelo pela conexão de conta e faz upsert em `whatsapp_group_insights` + semeia `whatsapp_known_groups`.
Rodar na hora: `node insights.mjs --apply` (dry-run sem a flag). O timer `whatsapp-agent-insights` (User=deploy)
roda de hora em hora. A tela lê `whatsapp_group_insights` (RLS admin/whatsapp_editor) — **recarregue a página**.

## Arquivos
| Papel | Caminho |
|---|---|
| Migration (config) | `companium/supabase/migrations/20261026_whatsapp_group_agents_EXTERNAL.sql` |
| Migration (acompanhamento) | `companium/supabase/migrations/20261026b_whatsapp_group_insights_EXTERNAL.sql` |
| Tela | `companium/src/pages/WhatsappAgent.tsx` + `src/hooks/useWhatsappAgent.ts` |
| Conexão/QR (tela) | `companium/src/components/whatsapp/WhatsappConnectionPanel.tsx` + `src/hooks/useWhatsappConnection.ts` + `apps/whatsapp-admin/` |
| Acompanhamento (tela) | `companium/src/components/whatsapp/WhatsappGroupsMonitor.tsx` + `src/hooks/useWhatsappInsights.ts` |
| Rota | `companium/src/App.tsx` (`/admin/whatsapp`) |
| Sidebar | `companium/src/components/AppSidebar.tsx` (submenu Administração) |
| Serviço de sync | `companium/apps/whatsapp-agent/sync.mjs` |
| Serviço de acompanhamento | `companium/apps/whatsapp-agent/insights.mjs` |
| Units systemd | `companium/apps/whatsapp-agent/whatsapp-agent-sync.{service,timer}` + `whatsapp-agent-insights.{service,timer}` |
