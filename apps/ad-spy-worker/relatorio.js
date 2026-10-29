/**
 * Marketing › Clientes — RELATÓRIO: diagnóstico de um período escolhido.
 *
 * Quatro blocos (leitura crítica, prioridade única, causa/correlação, ação) sobre os números do
 * período que a pessoa escolheu, comparados com o período compatível e com as metas daquele recorte.
 *
 * ## A fronteira de confiança
 *
 * Os números chegam do BROWSER, e isso é o desenho, não um atalho: só o frontend reproduz o que o
 * dashboard mostra (metas mensais pró-rateadas, a base de faturamento do cliente, as correções
 * manuais de `crm_metric_overrides`). Um relatório que contradiz a tela não vale nada.
 *
 * O que o worker faz com esse payload:
 *
 *   - **aceita os NÚMEROS verbatim** e grava `origem_numeros`, para a procedência ficar registrada;
 *   - **valida a forma** e recusa (400) em vez de consertar: cliente que não está ativo, data
 *     inválida, período invertido ou longo demais, métrica desconhecida, valor não-finito;
 *   - **recalcula o que é barato e não depende de banco** — a janela comparável e o "termina hoje" —
 *     e grava divergência como aviso. É assim que se pega uma aba aberta desde ontem: o navegador
 *     não é autoridade sobre que dia é hoje, e é esse flag que decide o que o relatório pode afirmar.
 *
 * O que ele NÃO faz: reler o banco para conferir os números. A releitura discordaria (override,
 * folding de alias, a materialized view atualizada entre as duas leituras), e qualquer desempate
 * reintroduz justamente a contradição que este desenho existe para remover.
 */

import { createHash } from "node:crypto";
import { runAgentCli } from "./agent-cli.js";
import { buildRelatorioPrompt, parseRelatorioReply } from "./relatorio-prompt.js";
import {
  MAX_RELATORIO_CHARS,
  MAX_RELATORIO_DIAS,
  MAX_SNAPSHOT_BYTES,
  RELATORIO_AGENT_ID,
  RELATORIO_RUN_TIMEOUT_MS,
} from "./config.js";
import { coletarFichas, mesesDeCasa } from "./briefs.js";
import { patchReport } from "./db.js";
import { METRICA_IDS, diasNoPeriodo, janelaComparavel } from "../../shared/relatorio-metricas.js";
import { MAX_CRIATIVOS_RELATORIO } from "../../shared/relatorio-canais.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SnapshotInvalido extends Error {
  constructor(message) {
    super(message);
    this.name = "SnapshotInvalido";
    this.status = 400;
  }
}

/** A data de hoje em São Paulo, como YYYY-MM-DD. Mesma receita dos resumos. */
export function hojeEmSaoPaulo(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

function numeroOuNulo(v, onde) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SnapshotInvalido(`${onde} deve ser número finito ou null (recebi ${JSON.stringify(v)}).`);
  }
  return v;
}

/**
 * Confere o snapshot e devolve a versão canônica: a do cliente, com a janela comparável e o flag de
 * dado parcial RECALCULADOS aqui, e os avisos de divergência acrescentados.
 *
 * @returns {{ snapshot: object, avisos: object[] }}
 */
export function validarSnapshot(snapshot, { agora = new Date() } = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new SnapshotInvalido("Snapshot ausente.");
  }
  if (Number(snapshot.versao) !== 1) {
    throw new SnapshotInvalido(
      `Versão de snapshot desconhecida (${snapshot.versao}). Recarregue a página — o frontend e o ` +
        "worker estão em versões diferentes."
    );
  }

  const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  if (bytes > MAX_SNAPSHOT_BYTES) {
    // Recusa, nunca truncagem: um snapshot pela metade é uma mentira com cara de fato. A prosa do
    // Composer pode ser cortada porque degrada; número cortado inverte conclusão.
    throw new SnapshotInvalido(
      `Snapshot de ${Math.round(bytes / 1024)} KB excede o teto de ${Math.round(
        MAX_SNAPSHOT_BYTES / 1024
      )} KB. Isso indica dado cru no payload, não período grande.`
    );
  }

  const per = snapshot.periodo;
  if (!per || !ISO_DATE.test(String(per.de)) || !ISO_DATE.test(String(per.ate))) {
    throw new SnapshotInvalido("Período inválido: use YYYY-MM-DD em `de` e `ate`.");
  }
  if (String(per.ate) < String(per.de)) {
    throw new SnapshotInvalido("A data final do período não pode ser antes da inicial.");
  }
  const dias = diasNoPeriodo(per.de, per.ate);
  if (!dias || dias > MAX_RELATORIO_DIAS) {
    throw new SnapshotInvalido(
      `O período tem ${dias} dia(s); o máximo é ${MAX_RELATORIO_DIAS}. Acima disso as metas mensais ` +
        "rateadas atravessam meses demais para significar algo."
    );
  }

  const metricas = Array.isArray(snapshot.metricas) ? snapshot.metricas : [];
  if (!metricas.length) throw new SnapshotInvalido("Snapshot sem métrica nenhuma.");
  for (const m of metricas) {
    if (!METRICA_IDS.includes(m?.id)) {
      // A lista mora em `shared/relatorio-metricas.js`, lida pelos dois lados: uma métrica que a tela
      // manda e o worker não conhece é divergência de versão, não dado ruim.
      throw new SnapshotInvalido(`Métrica desconhecida: "${m?.id}".`);
    }
    numeroOuNulo(m?.a?.valor, `metricas.${m.id}.a.valor`);
    // Período simples: `b` vem null e não há valor a validar.
    if (m?.b) numeroOuNulo(m.b.valor, `metricas.${m.id}.b.valor`);
  }

  // --- criativos (opcionais, dentro do bloco `marketing`) ---------------------------------------
  // O `thumbnail` e o `link` daqui viram `src` e `href` na tela, inclusive meses depois, quando
  // ninguém lembra que o dado veio do browser. Esquema que não seja http(s) é recusado AQUI também,
  // não só na origem: a validação da tela protege a tela, esta protege o que foi gravado.
  const mkt = snapshot.marketing;
  if (mkt !== undefined) {
    if (!mkt || typeof mkt !== "object") throw new SnapshotInvalido("`marketing` deve ser objeto.");
    const criativos = Array.isArray(mkt.criativos) ? mkt.criativos : [];
    if (criativos.length > MAX_CRIATIVOS_RELATORIO) {
      throw new SnapshotInvalido(
        `${criativos.length} criativos excedem o teto de ${MAX_CRIATIVOS_RELATORIO}.`
      );
    }
    for (const c of criativos) {
      for (const campo of ["thumbnail", "link"]) {
        const url = c?.[campo];
        if (url === null || url === undefined || url === "") continue;
        if (!/^https?:\/\//i.test(String(url))) {
          throw new SnapshotInvalido(
            `marketing.criativos.${campo} precisa ser http(s): recebi "${url}".`
          );
        }
      }
      for (const campo of ["gasto", "resultados", "cpl", "hookRate", "holdRate", "impressoes"]) {
        numeroOuNulo(c?.[campo], `marketing.criativos.${c?.codigo ?? "?"}.${campo}`);
      }
    }
  }

  const avisos = Array.isArray(snapshot.avisos) ? [...snapshot.avisos] : [];

  // --- o que o worker recalcula -----------------------------------------------------------------
  // Só quando a tela pediu comparação: relatório de período simples não tem comparável a conferir.
  const temComparacao = snapshot.comparacao != null;
  let comparacaoConferida = null;
  if (temComparacao) {
    const janela = janelaComparavel({ de: per.de, ate: per.ate, kind: per.kind });
    const informada = snapshot.comparacao || {};
    if (janela && (informada.de !== janela.de || informada.ate !== janela.ate)) {
      avisos.push({
        codigo: "comparacao_divergente",
        metricas: [],
        detalhe:
          `A tela informou ${informada.de}..${informada.ate} como período comparável, mas a regra ` +
          `"${janela.regra}" para este recorte dá ${janela.de}..${janela.ate}. Os números do ` +
          "comparável são os que a tela enviou — leia a diferença com cautela.",
      });
    }
    comparacaoConferida = { ...informada, conferidaPeloWorker: janela ?? null };
  }

  // O relógio do navegador não é autoridade sobre que dia é hoje, e este flag decide o que o
  // relatório PODE afirmar: um período que termina hoje lê dados possivelmente incompletos.
  const hoje = hojeEmSaoPaulo(agora);
  const terminaHoje = String(per.ate) >= hoje;
  const jaAvisado = avisos.some((a) => a.codigo === "dados_parciais");
  if (terminaHoje && !jaAvisado) {
    avisos.push({
      codigo: "dados_parciais",
      metricas: [],
      detalhe:
        `O período termina em ${per.ate}, que é hoje ou depois (fuso de São Paulo): os dados do dia ` +
        "corrente podem estar incompletos. Não conclua queda a partir do último dia.",
    });
  }

  return {
    snapshot: {
      ...snapshot,
      periodo: { ...per, dias },
      // A janela que o worker calculou fica registrada ao lado da informada, sem sobrescrever os
      // números — que são da tela. Null quando o relatório é de período simples.
      comparacao: comparacaoConferida,
    },
    avisos,
  };
}

function sessionId(cliente) {
  const short = createHash("sha256").update(`${cliente}:${Date.now()}`).digest("hex").slice(0, 16);
  // Mesma receita dos outros: sessão nova por execução (sessão viva reaproveitada faz o Gateway
  // abortar o turno em andamento) e teto de 64 chars.
  return `relatorio-${short}`;
}

/**
 * Escreve UM relatório, sobre a linha `running` que a rota já criou.
 *
 * A linha existe ANTES desta função rodar, de propósito: é ela que a tela faz polling. Criá-la aqui
 * deixaria a UI sem nada para acompanhar entre o 202 e o fim da chamada do agente.
 */
export async function runRelatorio({
  id,
  cliente,
  snapshot,
  observacao = "",
  log = () => {},
  agora = new Date(),
}) {
  const { snapshot: conferido, avisos } = validarSnapshot(snapshot, { agora });

  // A ficha vem da planilha, não do payload: é o único dado do relatório que o browser não manda, e
  // é de onde sai o responsável default da ação.
  const d = await coletarFichas();
  const ficha = d.clientes.find((c) => c.padrao === cliente);
  if (!ficha) throw new SnapshotInvalido(`Cliente "${cliente}" não está na lista de ativos da planilha.`);
  const especialidades = ficha.chaves.map((k) => d.espPor.get(k)).find((v) => v?.length) || [];

  const content = buildRelatorioPrompt({
    ficha: {
      nome: ficha.nome,
      especialidades,
      plano: ficha.plano,
      squad: ficha.squad,
      mesesDeCasa: mesesDeCasa(ficha.desde),
    },
    snapshot: { ...conferido, avisos },
    observacao,
    maxChars: MAX_RELATORIO_CHARS,
  });

  log(
    `[relatorio ${cliente}] ${conferido.periodo.de}..${conferido.periodo.ate} via ` +
      `${RELATORIO_AGENT_ID} (${content.length} chars, ${avisos.length} aviso(s))`
  );
  const { finalText } = await runAgentCli({
    agentId: RELATORIO_AGENT_ID,
    content,
    sessionId: sessionId(cliente),
    timeoutMs: RELATORIO_RUN_TIMEOUT_MS,
    log,
  });

  const { relatorioMd, relatorio, prioridade } = parseRelatorioReply(finalText);
  await patchReport(id, {
    nome_exibicao: ficha.nome,
    relatorio_md: relatorioMd,
    relatorio,
    prioridade,
    avisos,
    snapshot: conferido,
    snapshot_versao: conferido.versao,
    fontes: conferido.fontes ?? {},
    status: "ok",
    error: null,
    agent_id: RELATORIO_AGENT_ID,
  });
  log(
    `[relatorio ${cliente}] ok` +
      (prioridade ? ` (${prioridade})` : " (sem prioridade classificada)") +
      (relatorio ? "" : " — só prosa")
  );
  return { id, prioridade, avisos };
}
