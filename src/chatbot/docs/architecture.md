# Chatbot — arquitetura completa

Mapa de tudo que existe em [`src/chatbot/`](../) e como se conecta ao resto do
app, ao bridge OpenClaw e ao Supabase. Todos os diagramas são **Mermaid** — o
GitHub, o VS Code (extensão Markdown Preview Mermaid) e o mermaid.live renderizam
direto.

Docs irmãos: [`shell.md`](./shell.md) (DOM/UX do shell),
[`openclaw-contract.md`](./openclaw-contract.md) (contrato HTTP front↔bridge),
[`bridge-index-and-render.md`](./bridge-index-and-render.md) (o servidor),
[`audit-logging.md`](./audit-logging.md), [`plot-chart.md`](./plot-chart.md),
[`settings-menu.md`](./settings-menu.md), [`roadmap.md`](./roadmap.md).

---

## 1. A ideia central: core neutro + host React

A regra que organiza o projeto inteiro:

> **`core/` não sabe que React existe. `react/` não sabe como o chat funciona por dentro.**

O `core/` é TypeScript puro + DOM API. Ele cria seus próprios elementos,
gerencia seu próprio estado e fala com o mundo exterior por **quatro costuras
(seams)** injetadas na configuração: `Transport`, `ChatStorage`, `RenderOptions.renderContent`
e `ChatHooks`. Trocar de framework significa reescrever só a pasta `react/`.

```mermaid
graph LR
    subgraph HOST["react/ — host (React, app-específico)"]
        H1["useChatWidget<br/>orquestrador"]
        H2["OpenClawTransport"]
        H3["PlotModal / PlotChart"]
        H4["Supabase (audit, bots)"]
    end

    subgraph CORE["core/ — portável (zero deps de framework)"]
        C1["ChatbotShell"]
        C2["reducer + state"]
        C3["render.ts (DOM)"]
        C4["chatbot.css"]
    end

    H1 -->|"config: transport, storage,<br/>renderContent, hooks, menuItems"| C1
    C1 -->|"onItems / hooks.onEvent /<br/>hooks.onReply"| H1
    H2 -.->|"implementa Transport"| C1
    H3 -.->|"injetado via renderContent"| C3
    C1 --> C2 --> C3 --> C4
    H1 --> H4

    style CORE fill:#0d3b66,color:#fff
    style HOST fill:#1b5e20,color:#fff
```

---

## 2. Mapa de arquivos e dependências

```mermaid
graph TD
    subgraph core["src/chatbot/core/"]
        types["types.ts<br/><i>ChatMessage, BotReply,<br/>Artifact, PlotRef, ConversationItem</i>"]
        state["state.ts<br/><i>ChatState, ChatEvent, reducer</i>"]
        transport["transport.ts<br/><i>interface Transport + MockTransport</i>"]
        storage["storage.ts<br/><i>interface ChatStorage +<br/>LocalStorageChatStorage</i>"]
        audit["audit.ts<br/><i>ChatAuditEvent (só metadados)</i>"]
        render["render.ts<br/><i>renderMessages, esc,<br/>marked+DOMPurify, delegação</i>"]
        shell["shell.ts<br/><b>ChatbotShell</b> — a orquestra"]
        css["chatbot.css<br/><i>428 linhas, classes gh-*</i>"]
        index["index.ts<br/><i>(vazio — barrel não usado)</i>"]
    end

    subgraph react["src/chatbot/react/"]
        hook["useChatWidget.ts<br/><i>monta/desmonta o shell,<br/>resolve bot, keys, audit</i>"]
        oct["openClawTransport.ts<br/><i>fetch + parser NDJSON</i>"]
        host["ChatbotHost.tsx<br/><i>widget flutuante</i>"]
        page["ChatPage.tsx<br/><i>página /assistente</i>"]
        conv["ConversationArtifacts.tsx<br/><i>painel lateral</i>"]
        bsel["BotSelect.tsx<br/><i>seletor de agente</i>"]
        pmod["PlotModal.tsx"]
        lib["libraryApi.ts<br/><i>CRUD da Biblioteca</i>"]
        capi["conversationsApi.ts<br/><i>CRUD conversas + transcript (Supabase)</i>"]
        hyb["hybridStorage.ts<br/><i>ChatStorage: cache local + espelho Supabase</i>"]
    end

    subgraph app["resto do app"]
        App["App.tsx<br/><i>rotas + FloatingChat</i>"]
        plot["components/PlotChart.tsx<br/><i>recharts</i>"]
        bib["pages/Biblioteca.tsx"]
        auth["contexts/AuthContext"]
        sb["integrations/external-supabase"]
    end

    shell --> state & transport & storage & audit & render & types
    render --> types
    state --> types
    transport --> types
    storage --> types
    audit --> types

    hook --> shell & transport & storage & oct & css & auth & sb & capi & hyb
    hyb --> storage & sb
    capi --> sb
    oct --> transport & types
    host --> hook & pmod
    page --> hook & pmod & bsel & conv
    conv --> types & plot
    pmod --> plot
    bib --> lib & plot
    App --> host & page

    style shell fill:#0d3b66,color:#fff
    style hook fill:#1b5e20,color:#fff
```

**`core/index.ts` está vazio** — todos os imports são por caminho direto
(`@/chatbot/core/shell`). Se um dia o core virar pacote, é ali que vira o barrel.

---

## 3. As quatro costuras (seams)

O que o core define como **interface** e o host preenche com **implementação**:

| Seam | Interface (core) | Implementação padrão | Implementação neste app |
|---|---|---|---|
| **Transporte** | `Transport.send(req, opts)` | `MockTransport` (eco + streaming fake) | `OpenClawTransport` (HTTP + NDJSON) |
| **Persistência** | `ChatStorage` | `LocalStorageChatStorage` | `HybridChatStorage` (cache local + espelho Supabase, por conversa) |
| **Conteúdo rico** | `RenderOptions.renderContent` | link/thumbnail estático | botão → `PlotModal` + `PlotChart` |
| **Observabilidade** | `ChatHooks.onEvent` etc. | no-op | insert em `chatbot_audit` |

```mermaid
classDiagram
    class ChatbotShell {
        -ChatState state
        -ChatConfig config
        -AbortController inFlight
        -number rafId
        +mount(target)
        +unmount()
        +destroy()
        +open()
        +close()
        +reset()
        -dispatch(event)
        -submit()
        -retry(id)
        -callTransport(msg)
        -render()
        -deriveItems()
    }

    class ChatConfig {
        +Transport transport
        +ChatStorage storage
        +string title
        +ChatHooks hooks
        +ChatMenuItem[] menuItems
        +ChatTitleMenu titleMenu
        +boolean inline
        +HTMLElement composerSlot
        +onItems(items)
        +assistantLabel
        +renderContent(el, msg)
        +plotHref(plot)
    }

    class Transport["Transport «interface»"] {
        +send(SendRequest, SendOptions) Promise~BotReply~
    }
    class MockTransport
    class OpenClawTransport

    class ChatStorage["ChatStorage «interface»"] {
        +load() ChatMessage[]
        +save(messages)
        +clear()
    }
    class LocalStorageChatStorage
    class HybridChatStorage

    class ChatHooks["ChatHooks «interface»"] {
        +onOpen()
        +onClose()
        +onMessageSend(msg)
        +onReply(reply, msg)
        +onError(err, ctx)
        +onReset()
        +onEvent(ChatAuditEvent)
    }

    ChatbotShell o-- ChatConfig
    ChatConfig o-- Transport
    ChatConfig o-- ChatStorage
    ChatConfig o-- ChatHooks
    Transport <|.. MockTransport
    Transport <|.. OpenClawTransport
    ChatStorage <|.. LocalStorageChatStorage
    ChatStorage <|.. HybridChatStorage
```

---

## 4. Máquina de estados

`state.ts` é uma função **pura** `(state, event) => state`. Sem DOM, sem async,
sem `Date.now()` — o shell constrói as mensagens (ids, timestamps) e chama o
transporte; o reducer só calcula o próximo estado. O guard de exaustividade
(`const _exhaustive: never`) quebra o build se um `ChatEvent` novo ficar sem
tratamento.

`UIStatus` é **um campo discriminado**, não um punhado de booleanos — combinações
inválidas (`isOpen && isLoading && isClosed`) são irrepresentáveis.

```mermaid
stateDiagram-v2
    [*] --> closed

    closed --> open : open
    open --> closed : close

    open --> loading : send / retry
    loading --> open : receive
    loading --> streaming : streamStart no 1º chunk
    loading --> error : fail

    streaming --> streaming : streamChunk append no mesmo id
    streaming --> open : streamEnd troca o placeholder pelo final
    streaming --> error : fail

    error --> loading : retry
    error --> open : reset

    open --> open : setInput / reset
```

**Detalhe de performance:** `dispatch()` trata `streamChunk` de forma especial —
os renders são coalescidos em **um por frame** via `requestAnimationFrame`. Tokens
chegam mais rápido do que a tela repinta. Todo outro evento renderiza síncrono.

**Detalhe de identidade:** `render()` só reconstrói a lista quando
`state.messages !== lastMessages` (comparação por **referência**). Digitar
(`setInput`) mantém o mesmo array → nenhum rebuild de DOM enquanto se escreve.

---

## 5. Modelo de dados

```mermaid
erDiagram
    ChatMessage {
        string id
        Role role "user|assistant|system"
        string content
        number timestamp
        string status "sending|sent|failed"
        string failureReason
    }
    MessageMetadata {
        string intentType "message|service_request"
        ServiceType service "export|plot"
    }
    Artifact {
        string kind "pdf|png|md"
        string filename
        string mimeType
        string source "URL same-origin"
    }
    PlotRef {
        string id "id no banco"
        string title
        string thumbnailUrl
        unknown spec "PlotSpec p/ o host"
    }
    ActionResult {
        string action
        string result
    }
    ConversationItem {
        string kind "plot|artifact"
        string key "estável p/ dedupe"
        string msgId
    }

    ChatMessage ||--o| MessageMetadata : "metadata?"
    MessageMetadata ||--o| Artifact : "artifact?"
    MessageMetadata ||--o| PlotRef : "plot?"
    MessageMetadata ||--o{ ActionResult : "actionResults?"
    MessageMetadata ||--o{ ConversationItem : "deriveItems()"
```

`BotReply` (o que o transporte devolve) é uma união de duas formas:

```mermaid
graph LR
    BR["BotReply"] --> M["{ type: 'message',<br/>content }"]
    BR --> S["{ type: 'service_request',<br/>service, content,<br/>artifact?, plot?, actionResults? }"]
    M -->|messageFromReply| CM1["ChatMessage<br/>sem metadata"]
    S -->|messageFromReply| CM2["ChatMessage<br/>com metadata"]
    CM2 -->|deriveItems| CI["ConversationItem[]<br/>→ painel lateral"]

    style S fill:#7b1fa2,color:#fff
```

---

## 6. Ciclo de vida do mount

```mermaid
flowchart TD
    A["useChatWidget effect<br/>userId + currentAgent prontos"] --> B["cria Transport<br/>openclaw ou mock"]
    B --> C["new ChatbotShell(config)"]
    C --> D["shell.mount(el)"]
    D --> E["sessionId = makeId('sess')"]
    E --> F["storage.load()<br/>transcript salvo, TTL 24h"]
    F --> G["buildDom()<br/>launcher + panel + header +<br/>list + footer + announcer + resize"]
    G --> H["target.appendChild(root)"]
    H --> I["render()"]
    I --> J["emitItems()<br/>semeia o painel lateral"]
    J --> K{"inline?"}
    K -->|sim| L["open() automático"]
    K -->|não| M["espera clique no 💬"]

    N["cleanup do effect"] --> O["destroy() → unmount()"]
    O --> P["abort in-flight +<br/>rodar disposers +<br/>remover listeners de document +<br/>cancelar rAF + root.remove()"]

    style D fill:#0d3b66,color:#fff
    style O fill:#b71c1c,color:#fff
```

O effect tem deps `[userId, currentAgent, activeConversationId, inline]` e é
**assíncrono**: primeiro `loadTranscript(convId)` do Supabase → `seedCache()` no
localStorage → só então monta o shell (que faz `load()` síncrono do cache). Assim
**trocar de agente OU de conversa remonta o shell** com o transcript e a sessão
corretos. Uma guarda `cancelled` no cleanup evita montar se a conversa mudar no
meio do `await`. `reopenRef` reabre o painel flutuante após a remontagem.
Detalhes em [`use-chat-widget.md`](./use-chat-widget.md).

---

## 7. Árvore de DOM construída pelo shell

```mermaid
graph TD
    root[".gh-chatbot<br/><i>+ .gh-chatbot--inline<br/>+ .is-open / .is-loading</i>"]
    root --> launcher["button.gh-chatbot-launcher 💬<br/><i>escondido por CSS quando aberto</i>"]
    root --> panel[".gh-chatbot-panel<br/><i>role=dialog + aria-modal<br/>ou role=region se inline</i>"]

    panel --> header[".gh-chatbot-header"]
    panel --> list[".gh-chatbot-list<br/><i>role=log, aria-live=off</i>"]
    panel --> footer[".gh-chatbot-footer"]
    panel --> ann["div.gh-sr-only<br/><i>role=status, aria-live=polite</i>"]
    panel --> rz[".gh-chatbot-resize<br/><i>pointer events, 1x–1.5x</i>"]

    header --> title["título:<br/>span.gh-chatbot-title<br/><b>ou</b> .gh-chatbot-title-wrap<br/>com dropdown de bots"]
    header --> gear[".gh-chatbot-menu-wrap<br/>⚙ + .gh-chatbot-menu<br/><i>role=menu, setas + ESC</i>"]
    header --> close["button.gh-chatbot-close ×"]

    list --> sep[".msg-date-sep"]
    list --> bubble[".msg-wrapper.inbound|outbound|system<br/>└ .msg-bubble<br/>&nbsp;&nbsp;├ .msg-content<br/>&nbsp;&nbsp;├ a.msg-artifact <i>download nativo</i><br/>&nbsp;&nbsp;├ .msg-plot <i>[data-plot-container]</i><br/>&nbsp;&nbsp;└ .msg-meta + button.msg-retry"]
    list -.->|"só enquanto loading"| typing[".gh-chatbot-typing<br/><i>3 dots; irmão do list,<br/>reanexado após cada render</i>"]

    footer --> composer[".gh-chatbot-composer<br/>textarea + [composerSlot] + Send"]
    composer -.->|"portal do host"| slot[".gh-chatbot-composer-slot<br/><i>BotSelect na /assistente</i>"]

    style panel fill:#0d3b66,color:#fff
```

Pontos não-óbvios do DOM:

- O **indicador de digitação é irmão da lista**, não filho — o rebuild via
  `innerHTML` em `renderMessages` apagaria se estivesse dentro. Ele é
  reanexado/removido a cada `render()`.
- **Delegação de eventos**: o listener de clique fica no container estável
  (`attachListDelegation`), então sobrevive a todo rebuild de `innerHTML`.
  Downloads usam `<a download>` nativo — só o Retry precisa de JS.
- **Foco**: o keydown do trap fica em `document`, não no painel, para ESC e Tab
  funcionarem mesmo quando o clique derrubou o foco no `<body>`.
- **Segurança**: `esc()` é o único caminho para texto do usuário; resposta do bot
  vai por `marked` → `DOMPurify.sanitize`, e um hook do DOMPurify força
  `target="_blank" rel="noopener noreferrer"` em todo `<a>`.

---

## 8. Fluxo de uma mensagem (streaming)

```mermaid
sequenceDiagram
    actor U as Usuário
    participant TA as textarea
    participant SH as ChatbotShell
    participant RD as reducer
    participant DOM as render.ts / DOM
    participant TR as OpenClawTransport
    participant BR as Bridge /api/openclaw/chat
    participant GW as OpenClaw Gateway (WS)
    participant SB as Supabase

    U->>TA: digita + Enter
    TA->>SH: submit()
    SH->>RD: {type:'send', message} <i>otimista</i>
    RD-->>DOM: bolha do usuário + status loading + 3 dots
    SH->>SH: emit('message_send', traceId, textLength)
    SH-->>SB: insert chatbot_audit
    SH->>TR: send({message, history, signal}, {onChunk})

    TR->>BR: POST + Bearer JWT<br/>Accept: application/x-ndjson
    BR->>BR: verifica JWT (JWKS) → userId<br/>resolveAgent(userId, botId)<br/>guards: MAX_INFLIGHT + activeSessions
    BR->>GW: WebSocket, sessionId = web-userId-conversationId

    loop tokens
        GW-->>BR: snapshot cumulativo
        BR-->>TR: {"type":"delta","text":"…"}
        TR->>SH: onChunk(text)
        Note over SH: 1º chunk → streamStart<br/>(placeholder vazio com id fixo)
        SH->>RD: streamChunk
        RD-->>DOM: append, 1 render por rAF
    end

    GW-->>BR: final
    BR->>BR: aplica diretivas<br/>(export / plot) e persiste
    BR-->>TR: {"type":"final","reply":{…}}
    TR-->>SH: resolve BotReply
    SH->>RD: streamEnd (mesmo id do placeholder)
    SH->>SH: storage.save() + emitItems()
    SH-->>SB: insert chatbot_audit<br/>(reply, ok, durationMs, hasPlot, hasArtifact)
```

**Por que o id do assistente é criado antes do stream:** `streamStart` e
`streamEnd` precisam ser **a mesma entrada da lista**, senão o texto que cresceu
apareceria duplicado ao lado da versão final.

O frame `final` é **autoritativo**: uma resposta de plot/export transmite o texto
por deltas, mas os metadados estruturados (`plot`/`artifact`) só chegam no final.
Se o stream terminar sem `final`, o transporte cai no acumulado (`acc`) como
fallback defensivo.

### Caminho de erro

```mermaid
sequenceDiagram
    participant SH as ChatbotShell
    participant TR as Transport
    participant DOM as DOM

    SH->>TR: send()
    TR--xSH: reject(Error)
    alt signal já abortado
        SH->>SH: ignora (close/reset/unmount)
    else erro real
        SH->>SH: dispatch fail(messageId, reason)
        DOM-->>DOM: bolha .failed + button.msg-retry
        SH->>SH: hooks.onError + emit('error', durationMs)
    end
    Note over DOM: clique em Retry → delegação →<br/>dispatch retry → callTransport(mesma msg)
```

Status HTTP relevantes do bridge: **409** quando já existe um turno rodando na
mesma sessão (evita que o Gateway aborte a resposta quase pronta), **503** no cap
global de concorrência, **401/403** em auth/gating.

---

## 9. Deliverables: plots e documentos

Um `service_request` produz metadados na mensagem. Daí saem **três destinos**:

```mermaid
flowchart LR
    R["BotReply<br/>service_request"] --> MM["ChatMessage.metadata"]

    MM --> B1["Na bolha do chat"]
    MM --> B2["deriveItems() → onItems()"]
    MM --> B3["Persistido no bridge/Supabase"]

    B1 --> P1["plot → div[data-plot-container]<br/>hidratado por renderContent"]
    B1 --> P2["artifact → a.msg-artifact<br/>download nativo"]

    P1 --> PM["PlotModal → PlotChart<br/>+ Baixar PDF"]

    B2 --> SP["ConversationArtifacts<br/><i>painel esquerdo da /assistente</i>"]
    SP --> DET["detach → localStorage<br/><i>some do painel, fica na conversa</i>"]
    SP --> PM

    B3 --> LIB["Biblioteca /biblioteca<br/>libraryApi: list, rename, delete"]

    style PM fill:#7b1fa2,color:#fff
```

`deriveItems()` roda no **mount**, em **cada reply finalizado** e no **reset** —
nunca por frame de streaming. `key` (`plot:<id>` / `artifact:<msgId>:<filename>`)
é o identificador estável usado para dedupe e para o conjunto de "detached".

O `renderContent` é o ponto onde o React entra num core sem React: o core cria um
`<div>` vazio, o host preenche imperativamente com um `<button>` que chama
`setActivePlot(...)`. O contrato exige **idempotência** — ele roda a cada
re-render.

---

## 10. Os dois modos de montagem

```mermaid
graph TB
    subgraph F["Flutuante — ChatbotHost"]
        F1["App.tsx → FloatingChat<br/><i>escondido em /assistente</i>"]
        F2["useChatWidget(ref, {inline:false})"]
        F3["launcher 💬 + panel 360x520<br/>redimensionável até 1.5x"]
        F4["role=dialog, aria-modal,<br/>focus trap, ESC fecha"]
        F5["troca de bot: dropdown no header<br/>(titleMenu)"]
    end

    subgraph I["Página cheia — ChatPage (/assistente)"]
        I1["lazy route + DashboardLayout flush"]
        I2["useChatWidget(ref, {inline:true, composerSlot})"]
        I3["sem launcher, sem resize,<br/>abre sozinho, ocupa h-full"]
        I4["role=region, sem trap, ESC não fecha"]
        I5["troca de bot: BotSelect portado<br/>para o composerSlot do footer"]
        I6["ConversationArtifacts<br/>coluna 300px à esquerda"]
    end

    F2 --> S["mesmo ChatbotShell<br/>flag config.inline"]
    I2 --> S

    style S fill:#0d3b66,color:#fff
```

A flag `inline` desliga, dentro do core: launcher, `close()`, focus trap, ESC,
`titleMenu` e o handle de resize — e chama `open()` no mount.

---

## 11. Seleção de agente e permissões

```mermaid
flowchart TD
    Q["useQuery chatbot-bot-config"] --> T1["user_bot_settings<br/>bot_id, can_switch, allowed_bots"]
    Q --> T2["chatbot_bots<br/>id, label, enabled, is_default"]

    T1 & T2 --> R{"resolver agente"}
    R --> D["assigned = settings.bot_id<br/>ou o bot is_default"]
    D --> P{"pick salvo em localStorage<br/>é válido?"}
    P -->|"existe + habilitado +<br/>(== assigned OU canSwitch && em allowed_bots)"| U1["currentAgent = pick"]
    P -->|não| U2["currentAgent = assigned"]

    U1 & U2 --> M["remonta o shell<br/>com storage/conversationId do bot"]

    SW["switchAgent(id)"] --> W["grava pick + reopenRef=true"] --> M

    M --> SRV["botId vai no POST"]
    SRV --> GATE["bridge: resolveAgent(userId, botId)<br/><i>o cliente pede, o servidor decide</i>"]

    style GATE fill:#b71c1c,color:#fff
```

O `botId` enviado pelo cliente é **um pedido, não autoridade** — o bridge relê
`chatbot_bots` + `user_bot_settings` (cache ~30s) e rejeita com 400/403. A UI de
atribuição por usuário está em [`components/admin/UserBotSettings.tsx`](../../components/admin/UserBotSettings.tsx).

---

## 12. Persistência: Supabase (verdade) + cache local

**Multi-conversa:** um bot tem **N conversas**, cada uma com contexto/memória
própria. A fonte durável é o **Supabase** (sincroniza entre dispositivos); o
localStorage é só **cache** pra o `load()` síncrono do core.

**Supabase (fonte da verdade):**

| Tabela | Conteúdo | RLS |
|---|---|---|
| `chatbot_conversations` | lista de tópicos: `id, user_id, bot_id, title, created_at, updated_at` (o `id` **é** o `conversationId`) | dono (`auth.uid() = user_id`) |
| `chatbot_transcripts` | blob por conversa: `conversation_id (pk), user_id, messages jsonb, updated_at`; `on delete cascade` da conversa | dono |

**localStorage (cache + preferências):**

| Chave | Papel |
|---|---|
| `…:{botId}:{userId}:{convId}:transcript` | **cache** do blob (via `HybridChatStorage`); espelhado no Supabase a cada `save` |
| `…:{botId}:{userId}:activeConversation` | última conversa usada naquele bot |
| `…:{userId}:agent` | bot escolhido pelo usuário |
| `…:{botId}:{userId}:{convId}:detached` | `ConversationItem.key[]` escondidos do painel, **por conversa** |

Toda leitura/escrita de localStorage é `try/catch` silencioso — nunca derruba o chat.

> **Multi-conversa e memória:** cada conversa tem `id` próprio → `sessionId =
> web-{userId}-{hash(agentId, convId)}` no OpenClaw → **memória isolada por
> conversa**. "Iniciar nova conversa" agora **cria** um tópico (não apaga o
> atual): `hooks.onReset` → `newConversation()`. `storage.clear()` limpa só o
> cache local, nunca o Supabase. Apagar de verdade é o "Apagar tópico"
> (`deleteConversation`; o transcript vai junto por cascade).

> **Sync vs async:** o `ChatStorage` do core é **síncrono**. Por isso o
> `useChatWidget` **semeia** o cache com o transcript do Supabase **antes** de
> montar o shell, e o `HybridChatStorage` espelha os `save` de volta (fire-and-
> forget). Detalhes em [`use-chat-widget.md`](./use-chat-widget.md).

---

## 13. Auditoria

`ChatAuditEvent` carrega **só metadados** — nunca texto de conversa. `textLength`
existe; `text` não. O core emite; o host decide o destino (aqui, um insert em
`chatbot_audit`).

```mermaid
sequenceDiagram
    participant SH as ChatbotShell
    participant HK as hooks.onEvent
    participant SB as chatbot_audit

    SH->>HK: open / close / reset
    SH->>HK: message_send {traceId, inputKind, textLength}
    SH->>HK: reply {traceId, status:ok, durationMs,<br/>intentType, service, hasArtifact, hasPlot}
    SH->>HK: error {traceId, status:error, durationMs, errorMessage}
    HK->>SB: insert (fire-and-forget, erro só em console.debug)
    Note over SH,SB: botSessionId = 1 mount · traceId = 1 round-trip
```

---

## 14. Do navegador ao Gateway

```mermaid
graph LR
    subgraph browser["Navegador"]
        W["Widget<br/>OpenClawTransport"]
    end
    subgraph server["companium.example.com"]
        NG["nginx<br/><i>serve a SPA +<br/>proxy /api/openclaw/</i>"]
        BG["Bridge (Node, user deploy)<br/>127.0.0.1:18900<br/><i>index.js + render.js</i>"]
        OC["OpenClaw<br/>Gateway WS + CLI fallback"]
    end
    subgraph supa["Supabase"]
        AU["Auth / JWKS"]
        DB["chatbot_bots<br/>user_bot_settings<br/>chatbot_audit<br/>chatbot_plots<br/>chatbot_artifacts"]
        ST["Storage privado<br/>PDFs / PNGs / thumbs"]
    end

    W -->|"POST /api/openclaw/chat<br/>Bearer JWT + Accept: x-ndjson"| NG --> BG
    BG -->|"verifica ES256 via JWKS"| AU
    BG -->|"resolveAgent · persiste plot/artifact"| DB
    BG -->|"grava/lê bytes"| ST
    BG <-->|"WS: deltas cumulativos"| OC
    BG -.->|"NDJSON: delta* + final"| W

    W -->|"GET /files/:id<br/>/plots/:id/thumb.png<br/>/plots/:id/export.pdf<br/>/library · PATCH · DELETE"| NG

    style BG fill:#0d3b66,color:#fff
```

Chaveamento por env no front:

- `VITE_CHATBOT_BACKEND=openclaw` → `OpenClawTransport`; qualquer outro valor →
  `MockTransport` (700 ms, eco, **nunca toca a rede**).
- `VITE_OPENCLAW_ENDPOINT` (default `/api/openclaw/chat`) — o `apiBase` das
  outras rotas é derivado tirando o sufixo `/chat`.

Downloads via `<a download>` não conseguem mandar header `Authorization`; por isso
o bridge assina um **capability token** HMAC do id da linha (`?t=`), e as rotas de
download aceitam token **ou** JWT — é assim que o botão "Baixar PDF" do modal
consegue usar `fetch` com o JWT.

---

## 15. Onde o chatbot toca o resto do app

```mermaid
graph LR
    App["App.tsx"] -->|"monta FloatingChat"| CH["ChatbotHost"]
    App -->|"rota /assistente (lazy)"| CP["ChatPage"]
    App -->|"rota /biblioteca"| BB["Biblioteca"]

    CH & CP --> UCW["useChatWidget"]
    UCW --> AC["AuthContext<br/><i>user.id + access_token</i>"]
    UCW --> XS["external-supabase/client"]
    UCW --> SO["sonner (toasts de erro no PDF)"]

    CP --> CA["ConversationArtifacts"] --> PC["PlotChart (recharts)"]
    CH & CP --> PMD["PlotModal"] --> PC
    BB --> LAPI["libraryApi"] --> PC

    ADM["admin/UserBotSettings"] --> XS

    style UCW fill:#1b5e20,color:#fff
```

---

## 16. Invariantes que não devem ser quebrados

1. **`core/` nunca importa React, `@/components/*` ou o cliente Supabase.** Se
   precisar de algo do app, vira uma costura na `ChatConfig`.
2. **`reducer` continua puro.** Ids, timestamps e chamadas assíncronas ficam no
   shell — é isso que torna a conversa inteira testável sem DOM.
3. **`esc()` é o único caminho para texto do usuário.** Markdown do bot passa
   obrigatoriamente por `DOMPurify`.
4. **`renderContent` é idempotente** — roda em todo re-render.
5. **`streamStart` e `streamEnd` compartilham o mesmo message id.**
6. **O frame `final` do NDJSON é autoritativo** para metadados estruturados.
7. **`openclaw-contract.md` e `openClawTransport.ts` mudam juntos.**
8. **Auditoria não carrega texto cru** — só forma e metadados.
9. **`emitItems()` fora do caminho de streaming** — mount, reply finalizado e
   reset apenas.
10. **Storage falha em silêncio**, nunca derruba o chat.

---

## 17. Estado atual e próximos passos

Já entregue: core portável, streaming ponta a ponta (NDJSON ↔ WS do Gateway),
Markdown sanitizado, multi-agente com gating server-side, plots interativos no
chat e no painel, exports em PDF/PNG, Biblioteca com CRUD, auditoria persistida.

**Multi-conversa (em andamento):** camada de dados no Supabase
(`chatbot_conversations` + `chatbot_transcripts`), `HybridChatStorage` e o
refactor do `useChatWidget` (conversa ativa, remontagem por conversa) já estão
prontos. **Falta a UI** — a lista de conversas à esquerda (`ConversationList`
com menu de renomear/apagar), mover o painel de artifacts pra direita, o título
automático da 1ª mensagem e a migração do transcript local antigo. Veja
[`use-chat-widget.md`](./use-chat-widget.md).

Pendências priorizadas em [`roadmap.md`](./roadmap.md) — as principais: OpenClaw
sob systemd (hoje roda em `tmux`), rate limiting por usuário, testes automatizados
do reducer, página `/plots/:id` (o link do fallback hoje cai no NotFound),
responsividade mobile e o stub de "Reportar um bug".
