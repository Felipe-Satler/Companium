# Roadmap — Chatbot (melhorias e próximos passos)

Lista priorizada de tweaks/upgrades, baseada nos gaps reais do que já foi
construído. Tamanho aproximado: **P** (pequeno), **M** (médio), **G** (grande).

---

## 🔴 Confiabilidade / prontidão (antes de escalar)

| Item | Por que importa | Tam |
|---|---|---|
| **OpenClaw sob systemd** — hoje roda via `tmux`; o serviço systemd está inativo. | Se a sessão do `tmux` fechar, o bot cai. Precisa ser um serviço gerenciado que reinicia sozinho (`Restart=on-failure`). | P |
| **Persistir o audit log** — hoje o `onEvent` só faz `console.debug`. | Rastreabilidade e base pra métricas; hoje os eventos somem ao fechar o navegador. Enviar pra uma tabela Supabase (metadata only, sem texto cru — PII). | M |
| **Rate limiting por usuário** — hoje só existe um limite global de concorrência (`MAX_INFLIGHT`). | Controle de custo (cada turno gasta muitos tokens) e proteção contra abuso. | P |
| **Testes automatizados do core** — o state machine / reducer é puro. | Trivial de testar (sem DOM, sem mocks) e evita regressões conforme o produto cresce. | M |
| **Revisão de segurança** — JWT, service key, `spawn` do OpenClaw, download de arquivos. | Antes de abrir pra mais gente: revisar auth, ownership dos artefatos/plots, confinamento de path e injeção. | M |

---

## 🟡 Experiência do usuário (alto impacto, visível)

| Item | Por que importa | Tam |
|---|---|---|
| **Markdown nas respostas do bot** — hoje o texto é escapado (plain text via `esc()`). | Negrito, listas, links e tabelas → leitura muito melhor. O gancho já existe; falta renderizar Markdown com **sanitização** (ex.: DOMPurify), sem afrouxar o `esc()`. | M |
| **Streaming real** — resposta aparecendo token a token. | Percepção de rapidez; hoje espera o turno inteiro (segundos). A interface do transport (`onChunk`) **já foi desenhada** pra isso; falta o backend (SSE/WS do OpenClaw). | G |
| **Página `/plots/:id`** — o link do gráfico no chat hoje cai no NotFound da SPA. | Ver/compartilhar o plot em tela cheia e interativo (já temos o componente `PlotChart`). | P |
| **Plot interativo dentro do chat** — o `renderContent` delegate já existe no core. | Ver o gráfico na própria conversa, sem abrir a Biblioteca. | M |
| **Responsivo / mobile** — o painel é fixo em 360px. | Tela cheia no celular; hoje o layout é pensado pra desktop. | M |
| **Suavizar a troca de agente** — hoje re-monta e "pisca" o painel. | Preservar foco/scroll ao trocar de agente — polish de UX. | P |

---

## 🟢 Admin / operação

| Item | Por que importa | Tam |
|---|---|---|
| **UI pra gerenciar o catálogo de agentes** — adicionar/renomear/habilitar + definir o padrão (`is_default`). | Hoje só dá pra fazer via SQL; o admin deveria gerenciar pela tela (a atribuição por usuário já tem UI). | M |
| **Dashboard de uso** — a partir do audit persistido: uso por agente, latência, taxa de erro. | Valor de gestão — mostra adoção e saúde do sistema. | M |
| **Política de retenção de artefatos** — expirar PDFs/plots antigos. | Custo de storage no Supabase ao longo do tempo. | P |

---

## ⚪ Depois

- **"Reportar um bug"** de verdade — hoje é um `console.log` stub no menu do chat.
- **Export HTML interativo** — hoje só PDF estático (SVG renderizado no servidor).
- **Histórico de conversas** visível pro usuário — o OpenClaw já mantém sessões; falta a UI pra listar/retomar.
- **Modo público/informativo** (capability gating) — pra usuários não-autenticados receberem respostas só informativas.

---

## Sugestão: 3 pra fazer a seguir

1. **OpenClaw sob systemd + audit persistido** — confiabilidade e observabilidade (base de tudo).
2. **Markdown nas respostas** — ganho de UX imediato e barato, aparece na hora.
3. **Streaming** — o maior "uau" de experiência; a arquitetura já foi feita pensando nele.
