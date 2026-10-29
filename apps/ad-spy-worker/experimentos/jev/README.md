# Experimento: JEV sobre o corpus da Mineração

Fora do worker de propósito: nada aqui roda em produção nem é chamado pelo `index.js`. Serve para
decidir, com dado, se o JEV (TypeSafe AI, via AI Gateway da Vercel) merece entrar na Mineração.

**O que é o JEV.** Um modelo de decisão: recebe um texto e perguntas fechadas (sim/não, escolha,
nota numa escala) e devolve só a resposta, com probabilidade — sem texto, sem justificativa.
Custa US$ 0,042 por milhão de tokens de entrada (saída grátis): mil anúncios saem por centavos.

**O que ele mede é diferente do que os nossos filtros medem.** Os filtros da Mineração medem
DESEMPENHO pelo sinal público (longevidade, replicação, engajamento). O JEV mede o OFÍCIO do texto
(tipo de gancho, prova, especificidade). O experimento responde, nesta ordem:

1. **Ele entende anúncio de saúde em português?** — `comparar`, contra rótulos humanos às cegas.
2. **A probabilidade dele quer dizer alguma coisa?** — o acerto sobe com a confiança?
3. **Alguma característica do texto acompanha os anúncios que duram?** — `longevidade`. É a
   pergunta que interessa: a nota composta que inspirou isto (0,40 especificidade + 0,35 mostra
   resultado + 0,25 prova) é palpite. Aqui se mede no nosso nicho.

Duas lições da análise independente que moldaram as perguntas
([beri.net](https://www.beri.net/article/typesafe-jev-typed-decision-model-calibration-decomposition-shadow-eval)):
pergunta ampla vai mal (62,6% de acerto numa pergunta só, 95% dividida em cinco estreitas), e a
calibração não é confiável de fábrica — por isso toda pergunta aqui é estreita, toda escolha tem
"nenhum", e o `comparar` mostra o acerto por faixa de confiança.

## Preparar (uma vez)

1. Conta na Vercel → aba **AI Gateway** → cadastrar cartão (libera o crédito mensal grátis) →
   **API Keys** → criar chave. A MESMA chave serve para o JEV e para o Claude (`rotular-llm`).
2. Guardar a chave num `.env` **nesta pasta** (está no `.gitignore`; nunca no código). O `read -s`
   não mostra a chave nem a deixa no histórico do bash:

   ```bash
   cd ~/companium/apps/ad-spy-worker/experimentos/jev
   read -rsp "Chave do AI Gateway: " K && echo "AI_GATEWAY_API_KEY=$K" > .env && chmod 600 .env && unset K && echo
   ```

3. Instalar o SDK da Anthropic, só desta pasta (o worker não depende dele):

   ```bash
   npm install
   ```

## Rodar

Tudo de dentro desta pasta. Só o `exportar` precisa do banco (e por isso do `spy.env`).

```bash
# 1. Corpus: análises salvas na Biblioteca (têm transcrição), buscas inteiras (têm volume) e/ou
#    anunciantes inteiros (--anunciante, ver "Comparar DENTRO do anunciante").
#    Rode UM comando com todos os ids: o exportar sobrescreve o corpus.json.
node --env-file=../../spy.env jev.js exportar --biblioteca ID --biblioteca ID --run ID

# 2. Classificar com o JEV (--simular antes, para ver o custo). Para no teto (US$ 0,50) e nunca
#    paga duas vezes pela mesma peça: respostas em saida/respostas.jsonl.
node jev.js classificar --simular
node --env-file=.env jev.js classificar

# 3. Gabarito: sorteia 25 peças.
node jev.js gabarito

# 4. Referência pelo Claude (Opus 5.5, esforço alto) em vez de rotular à mão.
node jev.js rotular-llm --simular
node --env-file=.env jev.js rotular-llm

# 5. Comparar. Gera saida/discordancias.csv: decida SÓ essas linhas (coluna voce_decide) e rode
#    o comparar de novo — as decisões viram a referência daquelas células.
node jev.js comparar

# 6. O resto.
node jev.js longevidade
node jev.js ranking
```

Opções: `--amostra N` (classificar só N), `--max-usd 1.00`, `--zdr` (pede retenção zero de dados),
`--perguntas outro.json`, `--modelo <id>` (fixar uma versão do JEV), `--modelo-llm <id>` e
`--esforco medium` (rotular-llm), `--limiar 60` (longevidade), `--n 40` (gabarito),
`--saida <pasta>`.

**Mudar uma pergunta** muda o hash do conjunto, e as peças são classificadas de novo (as
respostas antigas ficam no arquivo, mas não se misturam). É o certo: resposta de uma pergunta não
vale para outra.

## Referência humana ou do Claude

O gabarito pode ser preenchido à mão (abra `gabarito.csv`, respostas aceitas em
`gabarito-LEIA.txt`) ou pelo `rotular-llm`. **Não é a mesma medida:**

- rótulo humano → o `comparar` mede **acerto**;
- rótulo do Claude → mede **concordância**. Os dois modelos podem errar juntos do mesmo jeito, e
  "concorda com um modelo grande" foi justamente o que a TypeSafe usou como propaganda.

Por isso o `comparar` separa as **discordâncias** em `saida/discordancias.csv`. Onde os dois
concordam, quase sempre os dois estão certos; a informação está onde divergem. Preencha
`voce_decide` com o valor certo, ou `jev` / `llm` para ficar com um dos lados. Decisões
preenchidas nunca são apagadas ao regravar o arquivo. Ao rodar de novo, o resultado volta a ser
**acerto** nessas células, e o script diz quantas vezes o próprio Claude errou nelas — a medida de
quanto a referência dele merece confiança.

O `rotular-llm` só preenche célula VAZIA (o que alguém rotulou à mão fica), guarda o gabarito
vazio em `gabarito-original.csv` e marca as linhas em `_rotulado_por`. Recusa ou resposta cortada
deixa a linha em branco, em vez de um rótulo inventado. Custo de referência: ~US$ 0,03 por peça
com o Opus 5.5 — o pensamento conta como saída; o `--simular` estima antes.

## Ler o resultado

**`comparar`** — por pergunta: acerto (ou concordância) contra a referência, o acerto do "chute do
mais comum" (90% num rótulo que é "não" em 90% dos casos não diz nada) e o acerto por faixa de
confiança. Pergunta ruim: reescreva a instrução antes de descartá-la — a mesma análise viu uma
descrição de critério mal escrita ficar ABAIXO do acaso.

**`longevidade`** — anúncios pagos que duraram (≥ 30 dias) contra os que NÃO duraram (inativos
com menos de 30). Ativo recente fica de fora: ainda pode durar, e contá-lo como fracasso seria
inventar. Por isso o corpus rende mais com buscas feitas em "Ativos e inativos". Com menos de 10
peças de um lado, o script avisa: é anedota. Orgânicos entram na coluna de correlação com o
engajamento. Esta parte NÃO depende do gabarito: a verdade aqui é a longevidade.

**`ranking`** — o top 10 pela nota do `perguntas.json`, sem texto repetido. Só vale a pena olhar
depois que o `longevidade` disser quais pesos usar.

## Comparar DENTRO do anunciante (o desenho que funciona)

**Primeira rodada (12/10/2026), 66 peças rotuladas: nenhum sinal real.** O `longevidade` como estava
desenhado não teve o que comparar: a busca da Biblioteca, ordenada por impressões, devolve quase
só sobreviventes (3 de 66 pararam antes de 30 dias, todos fora do nicho). E as diferenças que
apareceram vinham da SELEÇÃO, não do texto: as peças da Biblioteca foram mineradas com replicação
mínima 5 e têm transcrição (mais texto para achar "prova"), e entre todos os anunciantes, "tem
oferta" separa ótica de oftalmologista, não anúncio bom de ruim.

O desenho que controla isso é comparar criativos **do mesmo anunciante**: dentro dele, verba,
segmento e público ficam quase fixos, e o anúncio INATIVO traz a vida inteira dele. A rota "Company
Ads" da Scrape Creators traz todos os anúncios de uma página, ativos e inativos (1 crédito/página).

```bash
# 1. Quem anuncia na busca, com o page_id (escolha os do MESMO nicho):
node --env-file=../../spy.env jev.js anunciantes --run ID_DA_BUSCA

# 2. Todos os anúncios deles. Tetos: 3 páginas por anunciante, 40 créditos no total.
node --env-file=../../spy.env jev.js exportar --anunciante PAGE_ID --anunciante PAGE_ID --paginas 3 --max-creditos 40

# 3. Rotular (gabarito + JEV, rotular-llm, ou à mão) e comparar:
node jev.js gabarito --n 1000 --sobrescrever
node jev.js longevidade --por-anunciante --rotulos saida/gabarito-claude.csv
```

Por anunciante, o corte é a mediana de vida dos criativos que JÁ TERMINARAM. Longo = passou do
corte (inativo, ou ativo que já passou dele); curto = inativo abaixo do corte; ativo abaixo do
corte fica de fora (desfecho desconhecido). Só entram anunciantes com 3+ criativos terminados
(`--min-terminados`). O resultado diz, por sinal, a diferença combinada e **em quantos
anunciantes ela aponta para cada lado** — um sinal que aparece em 8 de 10 anunciantes vale mais
que uma diferença grande em 2.

A rota ordena por impressões: anunciante cortado no teto de páginas chega com os mais vistos
primeiro, e o `exportar` avisa quem foi cortado.

### Segunda rodada (12/10/2026): 8 oftalmologistas, 96 peças — critério NÃO atingido

**O desenho por mediana dos terminados também não tem dado.** Dos 8 anunciantes, 6 vieram sem
NENHUM anúncio inativo. Não é azar: na Biblioteca da Meta, anúncio comercial some quando para de
rodar — só ficam guardados os políticos (7 anos) e os entregues na União Europeia (1 ano). Os
poucos inativos que aparecem são exceção. **Com esta fonte, não existe "anúncio que morreu cedo"
para comparar, em nenhum anunciante brasileiro.** (De quebra: o filtro "Ativos e inativos" da
Mineração quase não muda o resultado em anúncio comercial.)

O que deu para medir é mais fraco: dentro de cada anunciante, os ativos ANTIGOS (≥ 60 dias,
sobreviveram) contra os NOVOS (< 30 dias, lote recém-lançado, ainda mistura de bons e ruins). Se
um traço aparece mais nos antigos, sugere que acompanha a sobrevivência — ou que o anunciante
mudou de estilo com o tempo; este dado não separa as duas coisas. Com 5 anunciantes (o HOPE saiu:
anúncios de uma linha) e rótulos do Claude:

| sinal | antigos − novos | anunciantes a favor × contra |
|---|---|---|
| fala com quem está "consciente da solução" (dúvidas, medo, qual procedimento) | −0,22 | 0 × 5 |
| fala com quem está "consciente do problema" (o incômodo dos óculos no dia a dia) | +0,17 | 5 × 0 |
| trata objeção | +0,12 | 4 × 1 |
| mostra o resultado acontecendo | +0,11 | 3 × 1 |
| prova concreta (caso de paciente) | +0,10 | 2 × 1 |

E entre replicados (≥ 2 cópias) × uma cópia, em 3 anunciantes: prova concreta +0,14 (3 × 0),
mostra resultado +0,12, gancho de caso de paciente +0,11.

**Leitura honesta.** Nada atinge o critério (8+ anunciantes). O sinal mais consistente (nível de
consciência, 5 de 5) é também o mais exposto a duas explicações que não são "funciona melhor":
mudança de estilo do anunciante ao longo do tempo, e acaso — com ~17 sinais testados, um deles
sair 5 × 0 por sorte não é raro. O fio mais coerente é o do CASO DE PACIENTE COM RESULTADO
DESCRITO: aparece positivo nos dois desfechos, mas pequeno. Serve como hipótese barata para
testar nos anúncios dos próprios clientes — não como regra, e não como nota.

**Decisão: não adotar o JEV.** O uso que justificaria pagar por ele (ordenar o grid por uma nota
de texto calibrada em desempenho) não tem como ser calibrado com dado público da Meta. Os 162
textos rotulados ficam em `saida/gabarito-claude*.csv` (fora do git) como gabarito pronto, caso
um dia valha medir o JEV — ou outro rotulador — pelo `comparar`.

## Critério de decisão (escrito antes de rodar)

O JEV entra na Mineração **se**:

- no `comparar`, as perguntas de gancho, prova e especificidade acertam **≥ 80%** e pelo menos
  **15 pontos acima** do chute do mais comum — com as discordâncias decididas por uma pessoa,
  quando a referência for do Claude; e
- no `longevidade --por-anunciante`, com **≥ 8 anunciantes**, pelo menos um sinal tem diferença
  **≥ 0,15** e aponta para o mesmo lado em **≥ 75%** dos anunciantes.

Se só o primeiro passar, ele serve para **rótulos no card** (filtrar o grid por tipo de gancho,
"tem prova") e para **contagens confiáveis** para o spyagent — sem nota. Se o segundo também
passar, a nota ganha os pesos medidos e o grid pode ordenar por ela.

## Limites conhecidos

- Lê só texto. Vídeo cujo gancho está no áudio precisa da transcrição — e a Mineração só transcreve
  os SELECIONADOS. Por isso a Biblioteca (já transcrita) é o melhor corpus para o `comparar`.
- TikTok da biblioteca pública não traz texto: não entra.
- Não trata o texto como hostil: um anúncio pode carregar instrução escondida. Para rótulos que
  só ordenam e etiquetam, o risco é baixo; não use o JEV para decidir ação automática.
- Acesso antecipado, uma região só, API que já mudou de nome (`evaluate` → `decide`, a rota HTTP
  continua `/v1/evaluate`).
