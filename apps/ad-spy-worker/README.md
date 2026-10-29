# ad-spy-worker

Backend da **Mineração** (`/marketing`): garimpa anúncios de concorrentes na Biblioteca de Anúncios
da Meta e do TikTok, e posts/reels orgânicos do Instagram — várias fontes na mesma busca —,
transcreve os vídeos **localmente**, e manda o corpus para um agente OpenClaw dedicado analisar.

Serviço separado do `openclaw-bridge` de propósito: Playwright (~400 MB) mais um sidecar
Python/Whisper inflariam um processo cuja única função é chat, e um crash no scraper não pode
derrubar o assistente.

```
BUSCA (repetível, blocos de 8)                    ANÁLISE (só os marcados)
POST /runs ──► searchBlock ──► grid                POST /runs/:id/analyze {adIds}
POST /runs/:id/more ──┘   (awaiting_selection)        ──► download ──► transcrição ──► agente spyagent
                                                          ──► "Salvar na Biblioteca" (POST /runs/:id/save)
```

**O pipeline tem uma decisão humana no meio.** A busca traz blocos de anúncios que SEMPRE passam nos
filtros de qualidade; a pessoa marca no grid quais entram; só os marcados são transcritos e
analisados. A análise pode ser salva na Biblioteca de Análises, compartilhada com a equipe.

**Blocos e créditos.** A Scrape Creators cobra por *requisição* (~30 anúncios/página), e os filtros
que mais importam — longevidade e anúncios usando o criativo (`collation_count`) — só existem depois
da resposta. Por isso a run guarda em `search_state` o cursor da API e o **excedente** que passou nos
filtros mas não coube no bloco: o próximo bloco sai dali sem gastar crédito. `SPY_MAX_PAGES_PER_BLOCK`
limita as páginas por bloco, para um filtro apertado não drenar o saldo em silêncio — o bloco volta
incompleto com uma nota dizendo quanto custou.

**Fontes e trilhas.** `run.sources` pode ter várias: `meta`, `tiktok` (Ad Library), e três modos do
Instagram — `instagram_reels` (busca de reels pelo tema), `instagram_hashtag` (posts da hashtag) e
`instagram_profile` (feed de @perfis ou posts colados, em `settings.instagramProfiles`) — mais
`instagram_ads`, que é a Biblioteca da Meta filtrada DEPOIS da resposta pelo posicionamento
`INSTAGRAM` (a API não filtra posicionamento na requisição; a página custa o mesmo crédito). Ela
não roda junto com `meta`: seria a mesma varredura paga duas vezes. Cada uma
vira uma **trilha** (`lanesFor`, em `sources/index.js`) com cursor e fim próprios em
`search_state.lanes`; excedente, vistos e orçamento são da busca inteira. O bloco divide a meta em
cotas iguais por trilha (a de quem se esgota passa às outras) e sai **intercalado**. Trilha que dá
erro vira nota e não derruba as outras. Instagram é **orgânico**: o filtro de longevidade não vale
para ele (a idade de um post não é prova de verba) e o de replicação vale só para a Meta; o dele é
`minViews`. `ad_spy_ads.source` é a plataforma; `found_via` diz qual trilha achou, e `metrics`
(jsonb) guarda os números de cada fonte.

A busca do Instagram e do TikTok devolve peças sem texto com frequência (reel de perfil sem
legenda; anúncio da biblioteca pública do TikTok sem copy). Antes de transcrever, os
**selecionados** sem texto passam pelo detalhe da fonte (Post/Reel Info, TikTok ad detail): 1
crédito por peça, uma vez só (`metrics.hydrated`).

**YouTube Shorts** (`youtube_shorts`, `youtube_hashtag`, `youtube_channel` + `settings.youtubeChannels`)
é orgânico como o Instagram, com uma diferença que muda o pipeline: **nenhuma rota da Scrape Creators
devolve o arquivo do vídeo**. Sem mp4 não há Whisper — a transcrição de um short selecionado é a
LEGENDA do próprio YouTube (`/v1/youtube/video/transcript`, 0 crédito quando não há legenda),
gravada com `transcript_model = 'legendas-youtube'`, e o provider declara `downloadable = false`
para o runner não tentar baixar. Completar um short custa até 2 créditos (detalhe + legenda). A
busca usa `includeExtras=true` (traz descrição e curtidas), cujo custo a documentação não diz: por
isso a busca conta o `credits_charged` que a resposta informa, e não a estimativa. No detalhe, o
short toca pelo player embutido (`youtube-nocookie.com`), que não expira.

### Sinais de qualidade por fonte

O que cada fonte da Scrape Creators expõe que diz algo sobre a QUALIDADE da peça, e o filtro que
usa cada sinal. A tela marca cada filtro com as fontes a que se aplica (`filtroFontes.ts`, que
espelha `makeQualityGate`; `mineracaoFiltroFontes.test.ts` prende os dois lados juntos).

| fonte | sinal | filtro | observação |
|---|---|---|---|
| Meta / IG Ads | dias no ar (`start_date` → hoje, ou → `end_date` se inativo) | longevidade | o sinal público mais forte: ~22% dos anúncios passam de 30 dias |
| Meta / IG Ads | `collation_count` | replicação | anunciante escalando a peça |
| Meta / IG Ads | `snapshot.page_like_count` | — (contexto) | tamanho do anunciante, não desempenho |
| TikTok | `first_shown_date` → `last_shown_date` | longevidade | |
| TikTok | `estimated_audience` (faixa) | alcance mínimo | usa o piso da faixa |
| Instagram, YouTube | visualizações | mínimo de visualizações | volume absoluto: favorece conta grande |
| Instagram, YouTube | (curtidas + comentários) / visualizações | engajamento mínimo (%) | Reels/Shorts de marca ≈ 0,4–0,6% (2025) |
| Instagram | visualizações / seguidores | multiplicador mínimo | o "outlier score"; o YouTube não traz inscritos na busca |

Sem filtro, de propósito: `reach_estimate`, `spend` e `impressions_with_index` da Meta vêm nulos
para anúncio comercial no Brasil (só existem para político/UE), e CTR/custo do TikTok são do
Creative Center, que a busca por palavra-chave não usa. Os sinais derivados (`engagementRate`,
`engagementBasis`, `viewsPerFollower`) são calculados no normalizador (`organicSignals`) e vão em
`metrics`; o feed de perfil do Instagram manda os seguidores na raiz, e eles são herdados por post.

A **sonda** (`POST /probe`) testa nas fontes de palavra-chave que a pessoa escolher (`fontes`:
`meta`, `instagram_ads`, `instagram_reels`, `instagram_hashtag`, `tiktok`, `youtube_shorts`,
`youtube_hashtag`; perfis e canais não entram). Cada
termo resolve a trilha pela mesma `lanesFor` da busca (`probeLaneFor`), então mede com a mesma
régua — e a hashtag testada é a do TERMO, não a digitada no formulário. Custa termos × fontes
créditos, com teto de `MAX_PROBE_CALLS` (15) por teste. No orgânico, a mediana é de visualizações.

> **Ordem de deploy das fontes novas:** (1) migração
> `20261008_ad_spy_fontes_instagram_tiktok_EXTERNAL.sql` — o worker novo grava `found_via`
> e `metrics` em todo upsert e falha sem as colunas, inclusive em busca só de Meta; (2) restart do
> worker; (3) reaplicar `agent/spyagent.md` (regra 13, fontes misturadas). Instagram e TikTok usam a
> mesma `SCRAPECREATORS_API_KEY` que a Meta já usa em produção.

**Links de mídia expiram.** A CDN da Meta assina com validade de horas, e a transcrição agora acontece
depois da seleção. O worker guarda `media_url` e, se o download falhar, renova o link pelo id
(`fetchAdById`, 1 crédito) antes de desistir daquele anúncio.

O progresso vai para o **banco**, não para a resposta HTTP. Atrás do nginx a desconexão do browser é
indetectável (a mesma lição do `persistBackgroundReply` do bridge). F5 no meio não perde nada.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.js` | Express: rotas, validação, guarda de usuário interno |
| `auth.js` | JWT via JWKS + **recusa quem tem linha em `user_client_scope`** |
| `runner.js` | Busca em blocos + análise dos marcados; grava `stages` a cada passo |
| `search.js` | Monta cada bloco: excedente, cursor, vistos, teto de páginas por bloco |
| `agent-cli.js` | Transporte do agente pela CLI do openclaw (fallback do Gateway) |
| `db.js` | PostgREST + Storage com `service_role` (ignora RLS) |
| `config.js` | Todas as env vars, com defaults |
| `sources/index.js` | Registro de providers + status para o `/health` |
| `sources/shared.js` | Normalização + o filtro de qualidade |
| `sources/meta-playwright.js` | Provider default: Chrome real, intercepta o GraphQL da página |
| `sources/meta-scrapecreators.js` | Substituto drop-in (1 crédito/request) |
| `sources/scrapecreators.js` | Cliente HTTP comum (chave, 402, ids grandes) |
| `sources/instagram.js` | Reels, hashtag, perfil, post por link; normaliza as duas famílias de resposta |
| `sources/youtube.js` | Shorts: busca, hashtag, canal, short por link; legenda como transcrição |
| `sources/tiktok-ads.js` | Ad Library: busca + detalhe; lê o formato público e o do Creative Center |
| `transcribe.js` | Driver do sidecar Python (sem ffmpeg) |
| `transcribe_whisper.py` | Lote de transcrição: carrega o modelo **uma vez** por run |
| `analyze.js` | Prompt por run + chamada ao agente + parsing da resposta |
| `agent/spyagent.md` | **Fonte de verdade das instruções do agente** |

## Pré-requisitos no servidor

```bash
npm ci                                    # dentro deste diretório
sudo npx playwright install-deps          # só libs de sistema; o Chrome é reaproveitado

# O Ubuntu 24.04 vem sem ensurepip, então `python3 -m venv` falha até instalar isto.
# Ajuste a versão se o `python3 --version` do servidor for outra.
sudo apt install -y python3.12-venv

# venv na HOME do deploy, não em /opt: o serviço roda como `deploy`, e `deploy` não escreve em
# /opt (Errno 13). Assim não precisa de sudo nem de ajustar dono depois.
python3 -m venv ~/ad-spy-venv
~/ad-spy-venv/bin/pip install -q faster-whisper
# e no spy.env:  SPY_PYTHON_BIN=/home/deploy/ad-spy-venv/bin/python
```

Conferir antes de seguir — se faltar qualquer um dos três, a transcrição não roda:

```bash
~/ad-spy-venv/bin/python -c "import faster_whisper, ctranslate2, av; print('ok')"
```

Sem faster-whisper o worker **continua funcionando**: minera e analisa normalmente, só que
a etapa Transcrição falha e a análise sai apenas com os textos dos anúncios — bem mais
fraca, já que o gancho costuma estar no áudio. O `GET /api/spy/health` diz qual é o caso.

**Não precisa de ffmpeg.** O faster-whisper 1.x decodifica e reamostra o mp4 com PyAV, que vem
junto no pacote. Uma versão anterior extraía um WAV 16 kHz com `ffmpeg` antes — era uma dependência
de sistema, um arquivo temporário por anúncio e mais um modo de falha, tudo para fazer o que a
biblioteca já faz sozinha.

O Chrome headless que o `render.js` do bridge já exige é reaproveitado
(`channel: "chrome"`, ou `CHROME_BIN`), então **não** há um segundo browser para baixar.

Sem GPU funciona: o sidecar detecta CUDA e cai para CPU com `small`/`int8`. Anúncios são curtos, e
mesmo na CPU uma run de 20 anúncios leva poucos minutos. Confira o que ele escolheu em
`GET /api/spy/health`.

## Env vars

| Var | Default | Observação |
|---|---|---|
| `PORT` / `HOST` | `18901` / `127.0.0.1` | |
| `SUPABASE_URL` | projeto companium-db | |
| `SUPABASE_SERVICE_KEY` | — | **obrigatória**; sem ela `POST /runs` responde 503 |
| `SPY_AGENT_ID` | `spyagent` | agente dedicado, **não** uma linha em `chatbot_bots` |
| `SPY_RUN_TIMEOUT_MS` | `600000` | corpus de 30 anúncios é prompt grande; 300s do chat é pouco |
| `MAX_CORPUS_CHARS` | `120000` | acima disso, trunca as transcrições mais longas primeiro |
| `SPY_META_PROVIDER` | `playwright` | **produção usa `scrapecreators`.** O default do código ficou `playwright`, mas o servidor define a variável — confira o processo, não o default |
| `SCRAPECREATORS_API_KEY` | — | Meta alternativa, **Instagram e TikTok** |
| `SPY_PROXY` | — | proxy residencial, se a Meta bloquear o IP do datacenter |
| `SPY_BROWSER_PROFILE` | — | perfil persistente: parece visitante recorrente, não bot |
| `CHROME_BIN` | — | vazio = `channel: "chrome"` |
| `SPY_PYTHON_BIN` | `python3` | aponte para o venv: `/home/deploy/ad-spy-venv/bin/python` |
| `SPY_WHISPER_DEVICE` / `_MODEL` | auto | vazio = detecta CUDA, senão CPU + `small` |
| `SPY_KEEP_VIDEO` | `0` | `1` guarda o mp4 no Storage depois de transcrever |
| `MAX_RUNS_INFLIGHT` | `1` | análises simultâneas; pico medido de 3.9 GB por análise (`medium`) vs. MemoryMax 6 GB |
| `MAX_SEARCHES_INFLIGHT` | `3` | buscas de bloco simultâneas — contador separado, para uma análise longa não travar a navegação dos outros |
| `SPY_BLOCK_SIZE` | `8` | anúncios que passam nos filtros por bloco |
| `SPY_MAX_PAGES_PER_BLOCK` | `3` | teto de páginas (= créditos na Scrape Creators) por bloco |
| `SPY_MAX_SELECTED` | `30` | máximo de anúncios marcados por análise |
| `SPY_AGENT_TRANSPORT` | `auto` | `auto` tenta o Gateway e cai para a CLI; `cli`; `gateway` |

## Deploy

```bash
cd /home/deploy/companium && git pull
cd apps/ad-spy-worker && npm ci
sudo cp ad-spy-worker.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ad-spy-worker
sudo systemctl restart nginx          # depois de aplicar o location ^~ /api/spy/
journalctl -u ad-spy-worker -f
```

### nginx

O bloco `location ^~ /api/spy/` está em `../openclaw-bridge/companium.example.com.nginx.conf.new`.

**Esse arquivo é um SNAPSHOT versionado, NÃO é o que o nginx lê.** O arquivo real é
`/etc/nginx/sites-available/companium.example.com` (o `sites-enabled/` só tem symlinks). O snapshot
é mantido byte a byte igual ao real de propósito: assim o diff abaixo é a prova de que ele não
mentiu — e ele já mentiu antes, escondendo um serviço inteiro (`/api/meta-reach` na :18910) que
existia em produção e não estava rastreado.

Confira a deriva de vez em quando, e SEMPRE depois de mexer no nginx:

```bash
diff <(sudo sed 's/[[:space:]]*$//' /etc/nginx/sites-available/companium.example.com) \
     <(sed 's/[[:space:]]*$//' ~/companium/apps/openclaw-bridge/companium.example.com.nginx.conf.new)
```

Sem saída = em dia. Com saída, **corrija a cópia do repo pela máquina local e dê push** — nunca
commite no servidor: o `auto-deploy.sh` faz `git reset --hard origin/main` e apaga o commit.

Hoje o servidor proxia três serviços: `:18900` openclaw-bridge, `:18910` meta-reach, `:18901`
ad-spy-worker.

Para aplicar o bloco no arquivo ativo:

```bash
nginx -T 2>/dev/null | grep -n "server_name companium" -B5 | head
ls -l /etc/nginx/sites-enabled/
# edita o arquivo ativo, aí:
sudo nginx -t && sudo systemctl reload nginx
curl -s https://companium.example.com/api/spy/health | head -c 120
```

**Confira o CORPO, não o status.** `/api/spy/health` não pede token, então responde 200 quando
funciona — mas o nginx servindo o `index.html` do SPA *também* responde 200 num GET. O status
sozinho não distingue:

| resposta | significado |
|---|---|
| `{"ok":true,...}` | chegou no worker ✅ |
| `<!doctype html>` | bloco ausente — o nginx serviu o SPA ❌ |
| `502` | bloco aplicado, mas o worker não está no ar (`systemctl status ad-spy-worker`) |

Num **POST** o sintoma é diferente e inconfundível: sem o bloco vem **405**, porque o nginx
recusa POST em arquivo estático. O worker nunca responderia 405.

O `^~` **não é opcional**: a rota de thumbnail termina em `.jpg` e, sem ele, cai no location de
asset estático e responde 404 — exatamente o bug que o comentário do bloco do bridge já registra.

`deploy.sh` na raiz só builda e publica o `dist/`; não precisa de mudança.

> **O auto-deploy NÃO reinicia este serviço.** Ele faz `git reset --hard origin/main` e builda o
> frontend — os arquivos do worker no disco ficam novos, mas o processo em execução continua com o
> código velho até alguém reiniciar. Depois de qualquer push que toque `apps/ad-spy-worker/`:
>
> ```bash
> cd ~/companium && git pull && sudo systemctl restart ad-spy-worker
> ```
>
> Sintoma típico de esquecer: um campo novo que você acabou de adicionar não aparece no
> `/api/spy/health`.

### Variáveis de ambiente: conferir o PROCESSO, não o arquivo

O `spy.env` estar certo não garante que o processo recebeu — arquivo errado, falta de restart e
linha sem newline final já causaram isso aqui. O que vale é o ambiente do processo vivo:

```bash
sudo tr '\0' '\n' < /proc/$(systemctl show -p MainPID --value ad-spy-worker)/environ \
  | grep -E 'SUPABASE|OPENCLAW|SPY_'
```

## O agente

`spyagent` é um agente OpenClaw **próprio**, e todo o contexto estático (persona, o que é a
Companium, como ler longevidade, o contrato de saída) vive na **definição dele** — não no prompt de
cada run. Isso não é cosmético:

- A página funciona para **qualquer usuário interno**, inclusive quem não tem bot configurado.
  Nada neste caminho chama `resolveAgent()` nem toca `chatbot_bots`.
- O prompt por run é basicamente **só o corpus**, que é onde os tokens devem ir.
- O contexto estático vai **uma vez**, na definição do agente (system prompt), em vez de
  ser reenviado dentro de cada mensagem. É onde o prompt cache do OpenClaw pega — o
  oposto do chat, que reinjeta `[COMPANIUM_CONTEXT]` + snapshot do cliente na mensagem
  de CADA turno, o que não é cacheável nem de graça.

### Transporte: Gateway ou CLI

O Gateway do OpenClaw recusou o `connect` deste worker com **"device identity required"** — ele
quer uma identidade de dispositivo pareada, que nem este serviço nem o `openclaw-bridge` carregam
no ambiente (`grep -c '^OPENCLAW_GATEWAY' bridge.env` = 0).

Por isso a análise tem dois transportes, escolhidos por `SPY_AGENT_TRANSPORT`:

| valor | comportamento |
|---|---|
| `auto` (default) | tenta o Gateway; se o handshake for recusado, cai para a CLI |
| `cli` | vai direto em `openclaw agent --json`, sem handshake |
| `gateway` | força o WebSocket e falha se ele recusar |

**Para este worker a CLI não é um plano B ruim — é provavelmente o certo.** O `runAgentStream`
existe para empurrar tokens para um browser conforme chegam; aqui não há ninguém ouvindo: o
progresso vai para `ad_spy_runs.stages` e a UI faz polling. A análise é uma chamada longa cujo
único produto é o texto final. Streaming não compra nada e custa um handshake que pode falhar.

Se conseguir a credencial do Gateway (provavelmente em `~/.openclaw/gateway.systemd.env`, chave
`auth.token.id` → `OPENCLAW_GATEWAY_AUTH_TOKEN`), basta pôr no `spy.env` que o `auto` volta a usar
o WebSocket sozinho.

Ele **não deve** ganhar linha em `chatbot_bots`: isso o tornaria selecionável no `BotSelect` e
alcançável pelo `/assistente`, o que não é a função dele.

Instruções e provisionamento: [`agent/spyagent.md`](agent/spyagent.md). **Editar aquele arquivo
exige re-aplicar no servidor** — mesma invariante que o `openclaw-contract.md` estabelece.

## O Contexto Operacional de Marketing › Clientes mora aqui também

Este serviço responde, além da Mineração, por `/api/spy/briefs*` — o texto por cliente da aba
**Marketing › Clientes** (`briefs.js`, `briefs-cron.js`, `agent/briefagent.md`).

> **Setembro de 2026: este texto deixou de falar de número.** Ele tinha quatro seções, duas sobre os
> números de duas semanas fechadas. Hoje tem duas — Contexto Operacional e Riscos — e é só ClickUp.
> Leitura de resultado é do **Relatório**, que recebe o período que a pessoa escolheu e as metas
> daquele período. Se você reiniciar o worker sem reaplicar `agent/briefagent.md` no servidor, o
> agente continua sendo instruído a nomear uma semana e citar resultado **sem receber número nenhum**
> — ou seja, inventa. Reaplique junto.

**O nome é feio e é de propósito.** "briefs" não tem nada a ver com "spy". O que se ganha é que o
bloco `location ^~ /api/spy/` do nginx é casamento por PREFIXO: as rotas novas entram sem tocar no
nginx, sem serviço novo e sem outro arquivo de env. A alternativa era mais quatro passos de deploy
— unit, bloco de nginx, env, restart — para um job que roda uma vez por noite. Se um dia isso virar
serviço próprio, o caminho é renomear o prefixo junto.

Duas coisas para não redescobrir do jeito difícil:

- **A coleta é DIVIDIDA, e a divisão é comportamento, não arrumação.** `coletarFichas()` lê só a
  planilha e as especialidades — é o que o Contexto Operacional usa. `coletarComMetricas()` acrescenta
  CRM + anúncios da semana fechada e só o **Ad Composer** a chama. O motivo: `assertMetricasVivas`
  roda DENTRO da coleta, antes de qualquer cliente ser escrito, então enquanto as duas vinham juntas
  uma leitura de CRM vazia abortava o job semanal INTEIRO por causa de um dado que o texto não lê.
  `src/test/briefsColeta.test.ts` prende isso pelo lado negativo: `coletarFichas()` não pode tocar no
  CRM.
- **A métrica de semana fechada continua existindo — para o Composer** (`semanasFechadas`, segunda a
  domingo, fuso de São Paulo): a semana passada contra a anterior, nunca a semana em curso. É isso
  que deixa uma composição ser regerada sem mudar de conclusão. Os números "de agora" não passam por
  agente nenhum: o card usa `useCRMClienteData`, o mesmo cálculo da página Clientes, rotulado
  "últimos 30 dias".
- **Especialidade vem de RPC, não da view.** `v_cliente_especialidades` termina em
  `is_approved(auth.uid())`, e predicado de VIEW não é RLS: nem `service_role` passa, porque não há
  `auth.uid()`. A view devolvia ZERO linhas **sem erro**, e todo resumo nascia sem especialidade. Hoje
  `readEspecialidades()` chama `especialidades_clientes_worker()` (SECURITY DEFINER, EXECUTE só para
  `service_role` — ver a migração de 28/09). O fallback para a view continua lá para o worker novo
  rodar antes da migração, mas ele **avisa com o nome do arquivo**; cair calado seria o bug de volta.
- `coletarComMetricas` lê **`mv_kommo_crm_agg`**, não a view `v_kommo_crm_agg`. A view embute o
  predicado de tenancy (`client_matchkey(client) = any(caller_kommo_cmpkeys())`) e, com
  `service_role`, não há `auth.uid()`: a leitura volta ZERO linhas **sem erro nenhum**. Há uma trava —
  uma semana sem nenhuma linha de CRM nem de anúncios levanta erro em vez de deixar o Composer
  afirmar que o cliente parou de investir.
- O casamento de cliente é portado do frontend em `client-match.js`, e os DADOS (os mapas de alias)
  vêm de `shared/client-aliases.js`, o mesmo arquivo que as telas usam.
  `src/test/clientMatchParidade.test.ts` compara os dois lados função a função — se alguém mexer
  num só, o teste quebra. Isso importa porque a chave com que o texto é gravado (`padrao`) tem de
  ser idêntica à que o frontend usa em `index.ativos`: se divergir, o card não acha o texto.

O job **pula quem já foi apurado nesta semana** (`precisaAtualizar`, por `semana_ate` — que agora
significa "situação apurada nesta semana", não "semana analisada"). O ClickUp não muda tanto em sete
dias que valha uma segunda chamada de agente, e comparar por semana dá retomada de graça: um job que
morreu no meio roda de novo e só pega quem faltou. Continuam entrando quem nunca foi apurado, quem
foi apurado numa semana anterior, e quem terminou em `error` ou ficou preso em `running` (worker
reiniciado no meio). O "atualizar agora" do card ignora esse pulo — ali a pessoa quer reconsultar o
ClickUp agora.

`metricas` fica `{}` nas linhas novas. A coluna não saiu porque as linhas antigas guardam os números
que embasaram o texto delas, e apagar isso perderia a auditoria do que já foi escrito; a tela mostra
a grade só quando `metricas.atual` existe, então ela desaparece sozinha conforme os textos são
reescritos.

Agendamento: `marketing-briefs.timer` + `.service` (oneshot, **segunda 04:30**). Semanal porque
cada execução gasta uma chamada de agente por cliente, e a forma de operar um cliente não muda de um
dia para o outro; quem precisa do estado de agora usa o "atualizar" no card. A lista de clientes,
essa sim, é relida sob demanda pelo botão "atualizar lista" da tela — cliente novo aparece na hora.
Instalar junto do worker:

```bash
sudo cp apps/ad-spy-worker/marketing-briefs.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now marketing-briefs.timer
systemctl list-timers marketing-briefs.timer
```

Primeira carga à mão, um cliente só para testar, ou reescrever todo mundo depois de mexer no prompt
do agente — sempre com o env carregado (ver a nota abaixo):

```bash
sudo systemctl start marketing-briefs.service          # a carteira inteira
cd apps/ad-spy-worker && set -a && . ./spy.env && set +a
node briefs-cron.js jose_ramos                          # um cliente
node briefs-cron.js --force                            # reescreve quem já está "em dia"
```

> **Os dois cron precisam do `spy.env`.** `SUPABASE_SERVICE_KEY` e o token do ClickUp chegam ao
> serviço pelo `EnvironmentFile=` do systemd; um `node ...-cron.js` direto do shell **não** os vê e
> falha com "SUPABASE_SERVICE_KEY ausente". Duas formas de rodar à mão:
>
> ```bash
> # 1) pela própria unidade — é o MESMO caminho do timer, e valida a unidade de quebra
> sudo systemctl start marketing-docs.service     # ou marketing-briefs.service
> journalctl -u marketing-docs -f
>
> # 2) carregando o env no shell — necessário quando se quer passar argumento
> cd ~/companium/apps/ad-spy-worker
> set -a; . ./spy.env; set +a
> node docs-cron.js jose_ramos
> ```

## Os documentos do ClickUp são INGERIDOS, não lidos ao vivo

`docs-sync.js` traz os Docs do ClickUp e mantém atualizado;
`GET /api/spy/clientes/:cliente/documentos` serve das tabelas, e `conteudoDoDocumento` (clickup.js)
serve o corpo de um deles para o preview e para o prompt do Ad Composer. A primeira versão lia a API
a cada abertura da aba — guardar mudou o propósito: o documento virou **insumo**, não só link.

### A unidade é a PÁGINA, não o Doc

Esta é a correção de 02/10/2026, e vale ler antes de mexer em qualquer coisa aqui. O documento de um
cliente neste workspace **não é um Doc: é uma página dentro de um Doc coletivo**.

```
groohub › Mapeamento do Cliente › Ativo › Mapeamento - Dra. Amanda Duarte
         (doc 8cknmgr-18393)         ↑ é uma PÁGINA, não uma pasta
```

"Mapeamento do Cliente" tem 66 páginas de clientes sob "Ativo" e 94 sob "Inativo"; "Briefing de
Conteúdo" segue a mesma forma, com uma página "Groohub" de material interno. Duas premissas do
desenho original caíram com isso:

- **"Cada cliente é uma tarefa."** A tarefa-pai `86a43dceu` chama-se "Mapeamento Estratégico" e não
  nomeia cliente nenhum; quem nomeava era o título do Doc. A tarefa segue sendo sinal, não O sinal.
- **"Doc com vários clientes é empate, logo não atribui."** Doc coletivo é o caso NORMAL. A regra de
  empate recusava o caso mais comum do workspace, e é por isso que 117 Docs sincronizados rendiam
  quase nenhuma atribuição.

A escala de `atribuido_via` passou a ser, do mais forte para o mais fraco: `pagina` (o título da
própria página nomeia o cliente — a convenção observada), `pagina_pai` (uma página ancestral o
nomeia), e então as três do Doc, que valem por herança: `tarefa`, `pasta`, `nome`. A herança é
**desligada** quando as páginas resolvem para mais de um cliente, ou para um cliente diferente do
que o Doc reivindica.

**E isto era também um vazamento, não só falta de cobertura.** `marketing_client_docs.conteudo_md`
guardava as páginas CONCATENADAS: para "Mapeamento do Cliente", um texto com 66 clientes dentro.
Enquanto o Doc estava sem cliente nada acontecia — mas "consertar a atribuição no nível do Doc" era
exatamente o que faria aquele texto virar insumo do Composer de UM deles, levando a estratégia dos
outros 65 ao prompt de um modelo. Hoje o conteúdo vive em `marketing_client_doc_pages.conteudo_md`,
uma linha por página, e **não existe mais um campo onde o texto de dois clientes caiba**. A coluna
antiga está vazia e marcada como morta; `listClientDocs`/`getClientDoc`, que eram seus únicos
leitores, foram apagadas.

A segunda metade da guarda está em `conteudoDoDocumento(pageId, { cliente })`: quem chama diz de
qual cliente espera que a página seja, e a função se recusa a devolver o corpo de uma página de
outro. Sem ela, a garantia dependeria de a tela mandar sempre o id certo — um acerto na camada mais
fácil de errar, com o resultado indo direto a um prompt.

**Templates ficam de fora** (`ehTemplate`, em `shared/clickup-doc-tipos.js`). Seis Docs do workspace
são moldes em branco e o nome deles casa com a allowlist justamente por serem o molde; alimentar o
Composer com formulário vazio é pior que não alimentar, porque o modelo preenche os espaços com
invenção e o resultado parece fundamentado. Só a palavra `template` — "modelo" está fora de
propósito, porque "Modelo de Negócio" é seção legítima de mapeamento estratégico.

**Por que fora do agente.** Lista e conteúdo de documento são dado, não diagnóstico. Pedir isso ao
`briefagent` custaria uma chamada de minutos para devolver o que uma requisição resolve, e poria um
LLM — que pode inventar um nome de arquivo — entre a pessoa e o documento. A regra 3 dele já o
proíbe de listar coisas, e a ferramenta dele não lê Docs: só tarefa.

**Um segredo, dois consumidores.** O token já existia no servidor para o `briefagent`
(`/home/deploy/.openclaw/.env`); as duas linhas são COPIADAS para o `spy.env` — ver
`ad-spy-worker.service`, que explica com a citação do `man systemd.exec` por que NÃO se pega
emprestado com um segundo `EnvironmentFile=`. `GET /api/spy/health` responde `clickup: { ok, env }`:
se achou credencial e sob qual nome, nunca o valor.

### O sync é incremental porque o custo é assimétrico

Listar os Docs do workspace é uma busca paginada. As outras duas etapas custam **uma chamada por
Doc** cada: `lerEstruturaDoc` (quais páginas ele tem) e `lerPaginasDoc` (o corpo delas). Então as
duas são incrementais pelo `date_updated` do ClickUp:

| etapa | decide | compara com | depende da allowlist? |
|---|---|---|---|
| enumerar páginas | `precisaEstrutura` | `estrutura_lida_em` | **não** — devolve títulos, não corpo |
| baixar o corpo | `precisaConteudo` | `conteudo_lido_em` | sim |

A enumeração roda para TODO Doc, inclusive os fora da allowlist, porque a página de um cliente
dentro de um Doc genérico precisa aparecer como link — e ela usa `/pageListing`, que não traz
conteúdo, justamente para a allowlist não ser respeitada só pela metade.

A **atribuição**, ao contrário das duas, roda sempre e sobre todas as páginas: ela é pura e sai de
`readDocPagesState()`, uma consulta. Tem de ser assim porque depende da carteira de clientes, que
muda — um cliente novo precisa receber seus documentos sem esperar que o ClickUp por coincidência
marque os Docs dele como editados.

Timer `marketing-docs.timer`, diário às 04:00 (e não semanal como os resumos, porque aqui não há
chamada de agente por cliente).

```bash
sudo cp apps/ad-spy-worker/marketing-docs.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now marketing-docs.timer
systemctl list-timers marketing-docs.timer

sudo systemctl start marketing-docs.service     # 1ª carga, à mão (a mais longa)
cd apps/ad-spy-worker && set -a && . ./spy.env && set +a
node docs-cron.js jose_ramos                     # só o conteúdo de um cliente
```

Vale conferir se a carga chegou ao banco, porque `LAST`/`PASSED` vazios no `list-timers` significam
que o sync **nunca rodou** — e aí todo documento aparece como "Conteúdo não encontrado no servidor"
por falta de dado, não por falha:

```sql
select count(*) as paginas,
       count(cliente) as atribuidas,
       count(conteudo_lido_em) as com_conteudo,
       count(*) filter (where tipo is null) as fora_da_allowlist
  from public.marketing_client_doc_pages;

-- e a coluna morta tem de estar vazia:
select count(*) from public.marketing_client_docs where conteudo_md is not null;  -- 0
```

### Cinco coisas que parecem detalhe e não são

**`archived` é FILTRO, não inclusão.** Medido: sem o parâmetro vieram 100 (o limite da página), com
`archived=true` vieram 5. A primeira versão passava `archived: "true"` achando que somava — pedia SÓ
os arquivados, e a aba trabalhava com 5 documentos do workspace todo. São duas varreduras,
deduplicadas por id.

**O conteúdo da maioria dos documentos é NULL de propósito.** `conteudo_md` só é preenchido para os
tipos da allowlist de `shared/clickup-doc-tipos.js`, e o padrão é FECHADO — não existe tipo "outros".
O workspace tem um documento chamado "Acessos"; uma denylist pegaria esse nome e deixaria passar o
próximo imprevisto ("Infra - chaves", "Credenciais GA4"), gravando a senha aqui e mandando-a a um
modelo. O documento desconhecido continua listado, com nome e link, e a pessoa abre no ClickUp —
onde o controle de acesso é o do ClickUp. `tipo is null` é o estado normal da maioria das linhas.

**A atribuição não interpreta `parent.type`.** Os códigos deste workspace são 1 e 12, não os 4/5/6/7
que a documentação de Views enumera; eu os codifiquei e a aba não achou documento nenhum. Hoje
`resolverPai` descobre o tipo por tentativa nos endpoints e `marketing_clickup_parents` guarda o
resultado para sempre — inclusive o `desconhecido`, que também é conhecimento. No nível do Doc,
empate real não escolhe: a linha fica sem cliente, porque mostrar o documento no cliente errado
agora produz peça criativa feita com a estratégia de outro. **No nível da página o empate quase não
ocorre**, porque o título da página nomeia um cliente só — ver a seção sobre a unidade ser a página.

**Permissão do token é problema do ClickUp, não de código.** 21 tarefas-pai respondem
`401 OAUTH_027 — Team not authorized` e a pasta `90131707316` (pai de "Documentação de Processos")
responde `401 ACCESS_022 — You do not have access to this Folder`. O sync conta e resume em uma
linha de log, em vez de uma linha de erro por documento mandando conferir uma credencial que está
certa. Quando a enumeração de um Doc é negada, entra UMA linha sintética (`page_id = 'doc:<doc_id>'`)
para o Doc não desaparecer da aba — e o corpo dele não é pedido, porque sem saber as páginas não há
onde gravar o corpo de cada uma.

**Chave ausente, não `null`.** Quem não foi rebaixado não manda `conteudo_md` no upsert. O upsert é
`merge-duplicates`: chave ausente preserva, chave com `null` APAGA — mandar `null` zeraria o conteúdo
de todo documento que não mudou, e o sync destruiria o insumo a cada execução. Mesma armadilha do
`metricas` dos resumos, e tem teste.

A varredura do que sumiu do ClickUp é por `sincronizado_em` (marca-e-varre) e é **pulada** quando a
listagem veio truncada ou vazia: leitura vazia é falha, não workspace vazio.

## Testar sem servidor

O `ad-spy-dev-stub.ts` na raiz do repo (plugin do Vite, já registrado) simula `/api/spy/*` e caminha
uma run falsa pelas cinco etapas num timer. `npm run dev`, abra `/marketing`: o formulário, a
animação do pipeline, o relatório e o histórico funcionam sem worker, sem Playwright, sem modelo e
sem gastar um crédito.

## Provider em isolado

```bash
node sources/cli.js --tema "harmonização facial" --limit 5            # playwright
SPY_META_PROVIDER=scrapecreators node sources/cli.js --tema "..." -n 5 # compara o shape
```

Rodar os dois e comparar a saída é o que **prova** que o adapter é de fato trocável.

## Riscos conhecidos

1. **A Meta bloquear o scraper a partir do IP do datacenter.** É a falha mais provável, e o motivo
   de o adapter da Scrape Creators existir desde já em vez de "depois". O provider distingue
   "sem resultado" de "bloqueado" (detecta parede de login/checkpoint) e diz o que fazer. **Foi o
   que aconteceu: produção roda com `SPY_META_PROVIDER=scrapecreators`.** O Playwright segue no
   repo como alternativa sem custo de crédito, não como o caminho em uso.
2. **A API oficial da Ad Library não serve.** `ad_type=ALL` só devolve anúncios comerciais para
   entrega na UE/Reino Unido; para `country=BR` vem só político/issue. Não perca tempo com ela.
3. **Disco.** Mitigado por descartar o vídeo após transcrever (`SPY_KEEP_VIDEO=0`) e pelo
   `on delete cascade` de `ad_spy_runs`.
