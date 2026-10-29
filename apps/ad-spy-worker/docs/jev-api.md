# API do Jev: o que a Fase 0 encontrou

Estado em 15/10/2026. As seções 1 a 5 vêm da documentação, com a fonte ao lado, e foram
conferidas contra as chamadas reais. A seção 6 é o que foi medido, gravado pelo
`scripts/jev-spike.js`.

**Resumo medido:** a rota `/api/alpha/decisions` do OpenRouter funciona com o corpo da TypeSafe,
sem adaptação. As três chamadas levaram de 380 a 645 ms, com 389 a 476 tokens de entrada e
custo de US$ 0,000016 a 0,000020 cada. `usage.cost` é exatamente `tokens de entrada × 0,042 / 1e6`:
a saída não é cobrada. O endpoint compatível com OpenAI recusa o modelo (HTTP 400).

## 1. Endpoint

Há três rotas para o mesmo modelo. O corpo da requisição é o mesmo nas duas primeiras.

| Rota | URL | Modelo | Chave |
|---|---|---|---|
| OpenRouter (a que vamos usar) | `POST https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` (fixo) ou `~typesafe/jev-latest` (acompanha a versão mais nova) | `OPENROUTER_API_KEY` |
| TypeSafe direto | `POST https://api.typesafe.ai/v1/systemone` | `jev-latest` | chave da TypeSafe |
| Vercel AI Gateway | `POST https://ai-gateway.vercel.sh/v1/evaluate` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` |

- A rota do OpenRouter **não é** a compatível com OpenAI (`/api/v1/chat/completions`). É uma rota
  própria, em alpha, só para decisões. **Medido:** `/api/v1/chat/completions` devolve HTTP 400
  ("is a decisions model and cannot be used with the chat/completions endpoint"). Já
  `/api/v1/systemone`, a rota dos SDKs da TypeSafe, responde igual à `/api/alpha/decisions`.
  Ficamos com `/api/alpha/decisions`, a documentada pelo OpenRouter.
- O alias no OpenRouter leva til: `~typesafe/jev-latest`, e não `typesafe/jev-latest` como está
  no plano. Recomendo fixar `typesafe/jev-1.13`: os limiares das fases 2 e 3 são calibrados para
  uma versão, e um alias que muda de versão sozinho invalida a calibração sem avisar.
- A rota da Vercel é a que o experimento antigo (`experimentos/jev/jev.js`) usa. Ela devolveu 403
  no plano gratuito em 12/10, e o nome da rota já mudou uma vez (`evaluate` → `decide`). Fica
  como alternativa, não como caminho.

Cabeçalhos, iguais nas três: `Authorization: Bearer <chave>` e `Content-Type: application/json`.

## 2. Payload

```json
{
  "model": "typesafe/jev-1.13",
  "state": "texto do anúncio, ou um objeto JSON",
  "questions": {
    "mostra_preco": {
      "type": "noul",
      "instructions": "Este anúncio mostra preço?",
      "criteria": { "true": "Traz um valor em dinheiro", "false": "Nenhum valor aparece" }
    },
    "especialidade": {
      "type": "choice",
      "instructions": "De qual especialidade médica é este anúncio?",
      "criteria": { "dermatologia": "Pele, cabelo e unhas", "outra": "Nenhuma das anteriores" }
    },
    "relevancia": {
      "type": "score",
      "instructions": "Qual a relevância para a busca?",
      "criteria": ["sem relação", "assunto próximo", "exatamente o que se procura"]
    }
  }
}
```

| Campo | Tipo | Regra |
|---|---|---|
| `state` | texto, objeto ou lista | obrigatório |
| `model` | texto | obrigatório |
| `questions` | mapa id → pergunta | obrigatório; o id é nosso e **não é enviado ao modelo** |
| `questions.*.type` | `noul`, `choice` ou `score` | obrigatório |
| `questions.*.instructions` | texto, objeto ou lista | obrigatório |
| `criteria` em `noul` | objeto `{ "true", "false" }` | opcional |
| `criteria` em `choice` | mapa opção → descrição | obrigatório, até 255 opções |
| `criteria` em `score` | lista ordenada de níveis | obrigatório, de 2 a 10 níveis |

Várias perguntas cabem em uma chamada só, sobre o mesmo `state`. É assim que as fases 4 e 5
fazem "uma chamada por peça".

## 3. Resposta

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "answers": {
    "mostra_preco": { "type": "noul", "noul": 0.95 },
    "especialidade": {
      "type": "choice",
      "choice": "dermatologia",
      "probabilities": { "dermatologia": 0.88, "outra": 0.12 },
      "confidence": 0.81
    },
    "relevancia": {
      "type": "score",
      "score": 1.05,
      "legend": { "0": "sem relação", "1": "assunto próximo", "2": "exatamente o que se procura" },
      "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 },
      "confidence": 0.92
    }
  },
  "usage": { "input_tokens": 357, "output_tokens": 38, "cost": 0.000014994 },
  "id": "gen-dec-...",
  "provider": "TypeSafe"
}
```

Os valores acima são os dos exemplos da documentação, não medições nossas. `usage.cost`, `id` e
`provider` são acréscimos do OpenRouter; a API direta da TypeSafe devolve só `model`, `answers` e
`usage.input_tokens` / `usage.output_tokens`.

## 4. Como a probabilidade aparece

Este é o ponto que muda o desenho do `jev.js` da Fase 1. Cada tipo devolve a probabilidade de um
jeito diferente, então "`{ valor, probabilidade }`" não sai pronto da API.

| Tipo | O que vem | Como ler |
|---|---|---|
| `noul` | `noul`: um número de 0 a 1 | É a probabilidade de **sim**. Não existe campo de confiança separado. Sim/não é decisão nossa (o limiar). |
| `choice` | `choice`, `probabilities`, `confidence` | `choice` é a opção mais provável. A probabilidade dela é `probabilities[choice]`. `confidence` é outra coisa: resume o quanto a distribuição é concentrada. |
| `score` | `score`, `legend`, `probabilities`, `confidence` | `score` é a média ponderada pelas probabilidades e **pode cair entre dois níveis** (1,05 no exemplo). |

Três consequências práticas:

1. **Nota de 1 a 5 vira índice de 0 a 4.** Os níveis são numerados a partir de zero, na ordem da
   lista. "Relevância 1 a 5" é `índice + 1`, e a nota chega fracionária. Para um nível inteiro,
   usa-se o de maior probabilidade em `probabilities`, não o `score` arredondado.
2. **Os limiares da Fase 3 valem direto sobre o `noul`.** `p ≥ 0,85` e `p ≤ 0,15` são sobre o
   próprio valor. Mas o "Perguntar ao grid" de hoje tem três vereditos (atende, atende em parte,
   não atende), e um `noul` só dá dois. Isso precisa ser decidido antes da Fase 2: ou a pergunta
   vira `choice` com três opções, ou a zona incerta do `noul` é sempre do agente.
3. **`confidence` e probabilidade da opção não são o mesmo número.** No exemplo da documentação,
   a opção tem 0,88 e a `confidence` é 0,81. A tabela de calibração da Fase 2 deve usar a
   probabilidade da opção escolhida.

O Jev também não devolve trecho. O "Perguntar ao grid" de hoje exige o trecho literal que
justifica o veredito; uma resposta que venha do Jev fica sem ele.

## 5. Limites, erros e preço

| Item | Valor | Fonte |
|---|---|---|
| Contexto no OpenRouter | 32.000 tokens | OpenRouter |
| Contexto na TypeSafe | 64.000 por requisição, até 32.000 para `state` mais a pergunta mais longa | OpenRouter, citando a TypeSafe |
| Preço | US$ 0,042 por milhão de tokens de entrada; saída gratuita | OpenRouter, 21/09/2026 |
| Limite de requisições | não documentado em nenhuma das duas | — |
| Latência | não vem na resposta; mede-se no cliente | — |

Erros documentados pela TypeSafe: `401` (chave), `422` (validação; o corpo diz o campo), `429`
(limite; repetir com espera crescente) e `529` (sobrecarga; repetir). O `jev.js` da Fase 1 deve
tratar `429` e `529` como transitórios, além de rede e `5xx`. O "~1.200 req/min" do plano não
tem fonte que eu tenha achado; o limite de concorrência fica como proteção, não como número
garantido.

Os tokens cobrados incluem as instruções e os critérios, não só o estado: o exemplo de uma frase
custa 307 tokens de entrada. Em anúncio curto, o texto das perguntas pesa mais que o anúncio.

## 6. Medições

Para repetir (3 chamadas ao Jev e 2 sondas de rota, menos de US$ 0,0001):

```
cd /home/tliuth/Documents/Groohub/companium/apps/ad-spy-worker
read -rsp "Chave do OpenRouter: " OPENROUTER_API_KEY && export OPENROUTER_API_KEY && echo
node scripts/jev-spike.js
```

Leitura das respostas:

- `noul`: 0,99 para "mostra preço" num texto com "R$ 290". Certo.
- `choice`: dermatologia com probabilidade 1 e `confidence` 1. Certo.
- `score`: os níveis voltaram numerados de 0 a 4, como previsto na seção 4. A nota 3,93
  corresponde a "5" na escala de 1 a 5 (índice 4, probabilidade 0,94). Certo.
- Os textos dos critérios de `score` voltam em `legend` como enviados. Por isso o prefixo "1:",
  "2:" que pus nos níveis é dispensável: a ordem da lista já dá o número.
- A primeira chamada levou 645 ms e as seguintes, ~385 ms. A diferença é a abertura da conexão.

<!-- medicoes:inicio -->
Rodado em 2026-10-15T12:11:42.912Z contra `https://openrouter.ai/api/alpha/decisions`, modelo `typesafe/jev-1.13`.

Texto do estado (o mesmo nas três chamadas):

```
Dra. Helena Pimentel | Dermatologia
Manchas no rosto que não saem com creme nenhum? O melasma tem tratamento, e ele começa com um
diagnóstico correto. Avaliação completa por R$ 290, com mapeamento da pele no mesmo dia.
Agende pelo WhatsApp e venha conhecer a clínica em Moema.
```

| Chamada | HTTP | Latência (ms) | Tokens entrada | Tokens saída | `usage.cost` (US$) | Custo pela tabela (US$) | Modelo servido |
|---|---|---|---|---|---|---|---|
| `noul` | 200 | 645 | 389 | 23 | 0.000016338 | 0.000016338 | typesafe/jev-1.13-20260917 |
| `choice` | 200 | 380 | 476 | 72 | 0.000019992 | 0.000019992 | typesafe/jev-1.13-20260917 |
| `score` | 200 | 387 | 445 | 20 | 0.00001869 | 0.000018690 | typesafe/jev-1.13-20260917 |

A latência é de ponta a ponta, medida daqui (inclui rede e TLS da primeira conexão).

### `noul`

Perguntas enviadas:

```json
{
  "mostra_preco": {
    "type": "noul",
    "instructions": "Este anúncio mostra preço?",
    "criteria": {
      "true": "O texto traz um valor em dinheiro, parcela ou desconto com número",
      "false": "Nenhum valor aparece no texto"
    }
  }
}
```

Resposta crua (HTTP 200):

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "answers": {
    "mostra_preco": {
      "type": "noul",
      "noul": 0.99
    }
  },
  "usage": {
    "input_tokens": 389,
    "output_tokens": 23,
    "cost": 0.000016338
  },
  "id": "gen-dec-1792066301-QYzdNXxyAS6x25RUYWiL",
  "provider": "TypeSafe"
}
```

### `choice`

Perguntas enviadas:

```json
{
  "especialidade": {
    "type": "choice",
    "instructions": "De qual especialidade médica é este anúncio?",
    "criteria": {
      "dermatologia": "Pele, cabelo e unhas",
      "oftalmologia": "Olhos e visão",
      "ortopedia": "Ossos, articulações e coluna",
      "cirurgia_plastica": "Cirurgias estéticas e reparadoras",
      "outra": "Nenhuma das anteriores"
    }
  }
}
```

Resposta crua (HTTP 200):

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "answers": {
    "especialidade": {
      "type": "choice",
      "choice": "dermatologia",
      "probabilities": {
        "dermatologia": 1,
        "oftalmologia": 0,
        "ortopedia": 0,
        "cirurgia_plastica": 0,
        "outra": 0
      },
      "confidence": 1
    }
  },
  "usage": {
    "input_tokens": 476,
    "output_tokens": 72,
    "cost": 0.000019992
  },
  "id": "gen-dec-1792066301-1gTR99YRxT3xQwezefbk",
  "provider": "TypeSafe"
}
```

### `score`

Perguntas enviadas:

```json
{
  "relevancia": {
    "type": "score",
    "instructions": "Qual a relevância deste anúncio para uma clínica de dermatologia que procura referências de anúncios de tratamento de melasma?",
    "criteria": [
      "1: sem relação com o tema",
      "2: mesma área médica, outro assunto",
      "3: assunto próximo",
      "4: mesmo assunto, abordagem diferente",
      "5: exatamente o que se procura"
    ]
  }
}
```

Resposta crua (HTTP 200):

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "answers": {
    "relevancia": {
      "type": "score",
      "score": 3.93,
      "legend": {
        "0": "1: sem relação com o tema",
        "1": "2: mesma área médica, outro assunto",
        "2": "3: assunto próximo",
        "3": "4: mesmo assunto, abordagem diferente",
        "4": "5: exatamente o que se procura"
      },
      "probabilities": {
        "0": 0,
        "1": 0,
        "2": 0.01,
        "3": 0.05,
        "4": 0.94
      },
      "confidence": 0.94
    }
  },
  "usage": {
    "input_tokens": 445,
    "output_tokens": 20,
    "cost": 0.00001869
  },
  "id": "gen-dec-1792066301-BzEiBEslzBaS3HyJdPvs",
  "provider": "TypeSafe"
}
```

### Sondas de rota

- **OpenAI-compatível (/api/v1/chat/completions) com `questions`**: HTTP 400

  ```
  {"error":{"message":"typesafe/jev-1.13 is a decisions model and cannot be used with the chat/completions endpoint. Use the /api/alpha/decisions endpoint instead.","code":400}}
  ```

- **Rota do SDK da TypeSafe (/api/v1/systemone)**: HTTP 200

  ```
  {"model":"typesafe/jev-1.13-20260917","answers":{"mostra_preco":{"type":"noul","noul":0.99}},"usage":{"input_tokens":389,"output_tokens":23,"cost":0.000016338},"id":"gen-dec-1792066302-fWVTXLcVNeZlwi6hVQGF","provider":"TypeSafe"}
  ```
<!-- medicoes:fim -->

## Fontes

- TypeSafe, referência da API: https://docs.typesafe.ai/api
- TypeSafe, perguntas: https://docs.typesafe.ai/primitives
- OpenRouter, "What Is Jev?": https://openrouter.ai/blog/insights/what-is-jev/
- A página `openrouter.ai/typesafe/jev-1.13` devolveu 404 para leitura automática; o identificador
  do modelo vem do artigo acima.
