# Plano Jev: fases 2 e 3 (reescritas em 15/10/2026)

> Substitui as fases 2 e 3 de `jev-pipeline.md`. As regras do projeto e o checklist de entrega do
> plano original continuam valendo. Uma fase por vez, numa branch `jev/fase-N`, sem push, e
> **pare para revisão** no fim de cada fase e em cada "Pare aqui".

## O que mudou e por quê

O Jev entra no "Perguntar ao grid" **só para descartar** peças que claramente não atendem.
Todo o resto continua com o `perguntaagent`, que dá o veredito final e o trecho literal.

- O trecho só existe para `atende` e `parcial`. Uma peça descartada como `nao` não perde nada que
  teria hoje. Todo veredito positivo na tela continua com citação.
- O Jev responde um único `noul`: "a peça faz isso, mesmo que em parte?". Ele não precisa separar
  `atende` de `parcial`. Há **um** limiar, `JEV_LIMIAR_REJEITE`. O `JEV_LIMIAR_ACEITE` sai do plano.
- O único erro novo possível é o **falso descarte**: o Jev diz "não" com confiança, a peça
  atendia e ninguém a lê. As duas fases medem esse erro primeiro, e o ganho depois.

O objetivo das duas fases é **responder se a integração vale a pena**, não entregá-la. "Não vale"
é um resultado aceitável e esperado. Se a resposta for não, o código fica atrás da flag (ou não
entra) e o resultado é registrado em `docs/`.

---

## Fase 2: avaliação offline (portão de decisão)

### 2.1 Inventário do histórico

As respostas ficam em `ad_spy_runs.question` (jsonb, migração `20261012_ad_spy_pergunta_ao_grid`):

- `question`: a pergunta na tela, com `texto`, `pedido_em`, `concluido_em`, `total`, `feito` e
  `respostas: { "<ad id>": { veredito, trecho, base } }`;
- `question.outras`: até 4 perguntas anteriores da mesma busca, no mesmo formato;
- as peças são as linhas de anúncio da run, e o texto lido vem de `textoDaPeca` em `pergunta.js`.

Crie `scripts/jev-inventario-grid.js` (somente leitura) e me mostre:

- quantas runs têm pergunta, quantas perguntas distintas e quantos pares (peça, pergunta) com
  veredito não nulo, separados por `atende` / `parcial` / `nao`;
- a fração de `nao` por pergunta. Ela é o teto do que o Jev pode poupar;
- o tempo do agente por peça lida: `(concluido_em − pedido_em) / peças lidas`. Peças reaproveitadas
  de `anteriores` não contam como lidas. Se o tempo não der para separar, diga que é aproximado;
- quantas peças mudaram de texto desde a resposta (o texto atual não é o que o agente leu).

O "Perguntar ao grid" foi construído em 12/10 e talvez quase não tenha uso. O mínimo para a
avaliação é **300 pares com veredito e 15 perguntas distintas**, sendo pelo menos 5 perguntas
específicas (poucos "atende") e 5 amplas (muitos "atende").

**Pare aqui e me mostre o inventário.**

### 2.2 Banco de perguntas (só se o histórico não bastar)

1. Eu escrevo de 15 a 20 perguntas reais, do jeito que faria na tela. Você propõe uma lista
   inicial misturando específicas e amplas, e eu corrijo. Não use perguntas que só você escreveu.
2. Escolha de 3 a 5 runs existentes com 40 ou mais peças com texto, de nichos diferentes.
3. `scripts/jev-gabarito-grid.js` roda o `perguntaagent` (via `runAgentCli`, igual ao produto,
   mesmos lotes de 20) sobre cada par (run, pergunta) e grava **só em arquivo local**
   (`saida/gabarito-grid.json`). Nada vai para `ad_spy_runs`. Roda no servidor, como `deploy`.
4. Antes de rodar, estime e me mostre: número de lotes, tempo esperado pelo tempo por peça do
   inventário e o que mais disputa o agente nesse intervalo. Rodar fora do horário de uso.

### 2.3 Script de avaliação

Crie `scripts/jev-avaliar-grid.js`, somente leitura no Supabase, que usa o `jev.js` da Fase 1:

- **Estado**: o mesmo texto que o agente leu, montado por `textoDaPeca` (importe, não copie).
  Peça com base `vazio` fica de fora, como no produto.
- **Pergunta** (um `noul` por peça):
  - `instructions`: `A peça faz o que esta pergunta descreve, mesmo que em parte ou de passagem? Pergunta: "<texto>"`
  - `criteria.true`: `Há no texto algo que faz isso, mesmo que de forma indireta ou parcial`
  - `criteria.false`: `Nada no texto faz isso`

  A formulação fica fixa durante toda a avaliação. Se eu quiser testar uma segunda, ela roda
  como variante separada e aparece separada no relatório. Não ajuste a formulação olhando o
  resultado.
- **Divisão**: separe as perguntas em duas metades, **por pergunta** e não por peça. Use a
  metade A para escolher o limiar e a metade B só para conferir. Peças da mesma pergunta nunca
  ficam nas duas metades.
- `--limite N` (amostra) e concorrência pelo `JEV_CONCORRENCIA`.

### 2.4 Relatório

Gere `saida/jev-avaliacao-<data>.md` e `.csv`, com tudo em separado para as metades A e B:

1. **Falso descarte por limiar** (0,02, 0,05, 0,10, 0,15, 0,20, 0,30). Para cada limiar `L`:
   - peças descartadas (`p ≤ L`) e a fração do total;
   - entre as descartadas, quantas o agente marcou `atende` e quantas `parcial`, em contagem e %;
   - fração poupada por pergunta: mediana, mínimo e em quantas perguntas o agente leria ao
     menos **1 lote a menos**. O agente lê lotes de 20 em sequência, então poupar 5 peças de 45
     não poupa lote nenhum.
2. **Tempo poupado estimado** por pergunta, em segundos: lotes poupados × tempo médio por lote
   (do inventário). Mediana e p90. Marque como estimativa.
3. **Calibração** do `noul` por faixa (0–0,1, …, 0,9–1,0): casos e fração que o agente marcou
   `atende` ou `parcial`.
4. **Custo e latência** do Jev: total, médio por pergunta, e p50/p95 por chamada.
5. **Os 20 falsos descartes de menor `p`**, com o texto da peça, o veredito e o trecho do agente,
   e uma coluna vazia `quem_acertou` (`jev` | `agente` | `ambiguo`) para eu preencher. O agente
   não é gabarito perfeito, e esta revisão corrige a taxa do item 1.
6. As 10 perguntas com maior e menor fração poupada, para ver se o ganho depende do tipo de
   pergunta.

### 2.5 Critério de decisão

Os números abaixo são fixados **antes** de ver o resultado. Se eu quiser mudá-los, mudo aqui,
antes de rodar a 2.3. Valem na **metade B**, com o limiar escolhido na A e depois da minha revisão
do item 5:

| Resultado | Condição |
|---|---|
| **Segue para a Fase 3** | existe `L` com falso descarte de `atende` ≤ 2% **e** de `atende`+`parcial` ≤ 5% das descartadas, **e** pelo menos 1 lote poupado em metade ou mais das perguntas |
| **Encerra** | nenhum `L` cumpre o limite de erro, **ou** o ganho mediano é menor que 1 lote por pergunta |
| **Zona cinzenta** | o erro passa, mas o ganho só aparece em perguntas específicas: o relatório diz isso, e eu decido |

No relatório, proponha o `JEV_LIMIAR_REJEITE` e diga qual resultado da tabela ele dá. Se o
resultado for "Encerra", registre em `docs/jev-api.md` (seção de conclusão) e pare: as fases 3 a
6 não começam.

**Pare aqui e me mostre o relatório.**

---

## Fase 3: piloto em produção, primeiro em sombra

Só começa se a Fase 2 terminar em "Segue". A Fase 3 também tem um portão: o produto só passa a
descartar depois que o modo sombra confirmar o número da Fase 2 com perguntas reais.

### Flags

| Variável | Valores | Efeito |
|---|---|---|
| `JEV_ENABLED` | `0` (padrão) / `1` | `0` = comportamento atual, idêntico, sem nenhuma chamada ao Jev |
| `JEV_MODO` | `sombra` (padrão) / `ativo` | só vale com `JEV_ENABLED=1` |
| `JEV_LIMIAR_REJEITE` | número | o da Fase 2 |
| `JEV_AUDITORIA` | fração, padrão `0.1` | no modo ativo, parte das descartadas que o agente lê assim mesmo |

### Formato gravado

Não precisa de migration. As respostas já ficam no jsonb `question.respostas`, e cada peça ganha
dois campos opcionais:

```
{ veredito, trecho, base, fonte: "agente" | "jev", jev_p: number | null }
```

- Resposta antiga, sem `fonte`, conta como `agente`. Sem `jev_p`, a tela mostra "—".
- A pergunta ganha `question.jev = { modo, limiar, chamadas, custo_usd, ms }` para o relatório.
  Com a flag desligada, nenhum desses campos aparece.

### 3.1 Modo sombra

Em `pergunta.js`, com `JEV_ENABLED=1` e `JEV_MODO=sombra`:

- Antes dos lotes, chame o Jev para todas as peças com texto, em paralelo e limitado pela
  concorrência, e grave `jev_p` em cada resposta.
- O agente lê **tudo**, como hoje. A tela não muda. A pessoa não vê nada do Jev.
- Falha do Jev (timeout, erro, `null`) grava `jev_p: null` e não atrasa nem quebra a pergunta.
  O Jev roda antes dos lotes, mas com teto de tempo próprio: estourou, segue sem ele.

Crie `scripts/jev-relatorio-sombra.js`, somente leitura, que calcula sobre as perguntas reais
gravadas os itens 1, 3 e 5 do relatório da Fase 2. Desta vez é o veredito real do agente, sobre a
pergunta real que alguém fez.

**Portão do modo sombra:** depois de 20 perguntas reais ou 2 semanas, o que vier antes, rode o
relatório. Ele segue para o modo ativo só se o falso descarte no `JEV_LIMIAR_REJEITE` cumprir os
mesmos limites da 2.5. Se piorar em relação à Fase 2, pare e me mostre: a diferença entre as
perguntas do banco e as reais é o resultado.

**Pare aqui e me mostre o relatório da sombra.**

### 3.2 Modo ativo

Com `JEV_MODO=ativo`:

- Peça com `jev_p ≤ JEV_LIMIAR_REJEITE` recebe `{ veredito: "nao", trecho: null, fonte: "jev" }` e
  não vai para o agente.
- **Auditoria**: uma fração `JEV_AUDITORIA` das descartadas, sorteada, vai para o agente assim
  mesmo. O veredito do agente vale na tela, e o par fica gravado. É isso que mede o falso
  descarte depois que o Jev começa a decidir; sem isso, o erro some de vista.
- Todo o resto (incerto, provável, `null`, erro) segue para o agente, como hoje.

UI (`src/components/marketing/mineracao/`):

- Peça descartada pelo Jev mostra "Descartada pelo Jev (p=0,04)", discreto, e um botão
  **"Ler mesmo assim"**, que manda só aquela peça ao agente.
- Rota nova para isso: `POST /api/spy/runs/:id/ask/reler { ids }`. Só aceita ids que estejam nas
  respostas da pergunta atual com `fonte: "jev"`; o resto é descartado. Atualize o dev stub.
- O uso do "Ler mesmo assim" e o veredito que ele dá também entram no relatório: é um falso
  descarte que alguém notou.

### 3.3 Relatório final do piloto

Depois de mais 20 perguntas no modo ativo, `jev-relatorio-sombra.js --ativo` compara com o
período em sombra:

- tempo real da pergunta (`concluido_em − pedido_em`), mediana e p90, sombra × ativo;
- falso descarte medido pela auditoria e pelo "Ler mesmo assim";
- custo do Jev somado.

| Resultado | Condição |
|---|---|
| **Mantém ligado** | falso descarte dentro dos limites da 2.5 **e** tempo mediano da pergunta ao menos 30% menor que em sombra |
| **Desliga** | qualquer uma das duas falha: `JEV_ENABLED=0`, e o código fica atrás da flag |

**Pare aqui e me mostre o relatório.** As fases 4 a 6 do plano original só se discutem depois.

### Testes da Fase 3 (`npx vitest run`, Jev e agente mockados)

- flag desligada: nenhuma chamada ao Jev, e respostas sem `fonte` nem `jev_p`, idênticas às de hoje;
- sombra: o agente recebe todas as peças, e `jev_p` fica gravado;
- ativo: peça com `p ≤ L` não chega ao agente e fica `nao` com `fonte: "jev"`;
- ativo: peça com `p > L` chega ao agente;
- falha ou timeout do Jev: todas as peças vão ao agente, e a pergunta termina normalmente;
- auditoria: com `JEV_AUDITORIA=1`, todas as descartadas vão ao agente, e com `0`, nenhuma;
- `reler`: id fora da pergunta, ou com `fonte: "agente"`, é recusado;
- resposta antiga, sem `fonte`, aparece como agente e com "—".

### Ordem para colocar no servidor

1. `spy.env`: `OPENROUTER_API_KEY`, `JEV_ENABLED=1`, `JEV_MODO=sombra`, `JEV_LIMIAR_REJEITE=<da Fase 2>`.
2. Push para `main` (deploy e restart automáticos). Não há migration.
3. Conferir no log do worker que a primeira pergunta gravou `jev_p`.
