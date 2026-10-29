/**
 * Marketing › Clientes — monta o CONTEXTO OPERACIONAL de cada cliente ativo com o agente OpenClaw.
 *
 * O trabalho aqui é: descobrir quem está ATIVO na planilha de projetos, montar a ficha de cada um
 * e pedir ao agente o contexto. O agente é `briefagent`, com contexto estático na própria definição
 * (agent/briefagent.md) e acesso ao ClickUp configurado no servidor.
 *
 * **Não há métrica neste caminho.** Até setembro de 2026 havia: o resumo trazia os números de duas
 * semanas fechadas e uma seção "Resultados da semana". Isso virou o Relatório, que recebe o período
 * que a pessoa escolheu e as metas dele. O que sobra aqui é o que só o ClickUp sabe.
 *
 * O que ainda usa semana fechada é o **Ad Composer**, via `coletarComMetricas()` — e é por isso que
 * `semanasFechadas`/`agregar`/`assertMetricasVivas` continuam morando neste arquivo em vez de serem
 * apagados junto com a métrica do resumo.
 *
 * A chave com que cada resumo é gravado (`padrao`) tem de ser a MESMA que o frontend usa em
 * `index.ativos`, senão o card não acha o resumo — daí o casamento de nomes de `client-match.js`,
 * portado do frontend e preso por teste de paridade.
 */

import { createHash } from "node:crypto";
import { runAgentCli } from "./agent-cli.js";
import { buildBriefPrompt, parseBriefReply } from "./briefs-prompt.js";
import {
  canonicalizeAdsClient,
  chavesCandidatas,
  clientMatchKey,
  foldMergedAdsClient,
} from "./client-match.js";
import { BRIEF_AGENT_ID, BRIEF_RUN_TIMEOUT_MS } from "./config.js";
import {
  listBriefs,
  readAdsRows,
  readCrmAgg,
  readEspecialidades,
  readFaturamentoConfig,
  readProjetosLista,
  upsertBrief,
} from "./db.js";

const DIA_MS = 86400000;

/** A data de hoje em São Paulo, como YYYY-MM-DD. */
function hojeEmSaoPaulo(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

function iso(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * As DUAS últimas semanas FECHADAS (segunda a domingo), em São Paulo.
 *
 * A semana corrente fica de fora de propósito, e é isso que faz a análise poder ser regerada a
 * qualquer momento: uma semana que já fechou não muda mais. Pedir o resumo na terça ou no sábado
 * devolve a MESMA janela e os MESMOS números, então o texto continua verdadeiro enquanto existir.
 * Com a janela móvel que havia antes, o texto nascia certo e apodrecia sozinho.
 *
 * O fuso é explícito porque a conta é sobre DIAS: uma execução às 22h de domingo em Brasília já é
 * segunda em UTC, e a janela pularia uma semana inteira sem ninguém perceber.
 */
export function semanasFechadas(agora = new Date()) {
  const hoje = new Date(`${hojeEmSaoPaulo(agora)}T00:00:00Z`);
  // getUTCDay: 0=domingo. Reindexa para 0=segunda.
  const diaDaSemana = (hoje.getUTCDay() + 6) % 7;
  const segundaDestaSemana = new Date(hoje.getTime() - diaDaSemana * DIA_MS);
  const ate = new Date(segundaDestaSemana.getTime() - DIA_MS); // domingo passado
  const de = new Date(ate.getTime() - 6 * DIA_MS); // segunda passada
  const ateAnterior = new Date(de.getTime() - DIA_MS);
  const deAnterior = new Date(ateAnterior.getTime() - 6 * DIA_MS);
  return { de: iso(de), ate: iso(ate), deAnterior: iso(deAnterior), ateAnterior: iso(ateAnterior) };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Soma os eventos do CRM e o investimento das contas de anúncio, por chave de cliente.
 *
 * `basisPor` traz a base do Faturamento Bruto escolhida por cliente; sem linha salva vale
 * realizadas + realizados, o mesmo default do frontend.
 */
export function agregar({ crmRows = [], adsRows = [], basisPor = new Map() }) {
  const por = new Map();
  const pega = (key) => {
    if (!por.has(key)) {
      por.set(key, {
        investimento: 0,
        leadsTrafego: 0,
        leadsCRM: 0,
        consultasAgendadas: 0,
        valorConsultasAgendadas: 0,
        valorConsultasRealizadas: 0,
        valorProcedimentosAgendados: 0,
        valorProcedimentosRealizados: 0,
      });
    }
    return por.get(key);
  };

  for (const r of crmRows) {
    const key = clientMatchKey(r.client);
    if (!key) continue;
    const acc = pega(key);
    const qtd = num(r.qtd);
    const valor = num(r.valor);
    switch (r.event_type) {
      case "lead":
        acc.leadsCRM += qtd;
        break;
      case "consulta_agendada":
        acc.consultasAgendadas += qtd;
        acc.valorConsultasAgendadas += valor;
        break;
      case "consulta_realizada":
        acc.valorConsultasRealizadas += valor;
        break;
      case "proc_agendado":
        acc.valorProcedimentosAgendados += valor;
        break;
      case "proc_realizado":
        acc.valorProcedimentosRealizados += valor;
        break;
      default:
        break;
    }
  }

  for (const r of adsRows) {
    // Sem canal: a fusão "médico divide o cliente no CRM" vale aqui, porque o resumo soma os dois
    // canais. Só a tela de Meta Ads mantém a conta separada.
    const canonical = foldMergedAdsClient(canonicalizeAdsClient(r.Client), undefined);
    const key = clientMatchKey(canonical);
    if (!key) continue;
    const acc = pega(key);
    acc.investimento += num(r.Valor_usado_BRL);
    acc.leadsTrafego += num(r.Lead) + num(r.Mensagens_iniciadas);
  }

  for (const [key, acc] of por) {
    const basis = basisPor.get(key) || { consulta: "realizadas", procedimento: "realizados" };
    const c =
      basis.consulta === "agendadas" ? acc.valorConsultasAgendadas : acc.valorConsultasRealizadas;
    const p =
      basis.procedimento === "agendados"
        ? acc.valorProcedimentosAgendados
        : acc.valorProcedimentosRealizados;
    acc.faturamentoBruto = c + p;
    acc.roas = acc.investimento > 0 ? acc.faturamentoBruto / acc.investimento : null;
  }
  return por;
}

/** Status ATIVO é casado por regex ancorada: "INATIVO" contém "ativo" e NÃO pode passar. */
function ehAtivo(status) {
  if (!status) return false;
  return /^ativ/.test(
    String(status).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()
  );
}

/**
 * Clientes ATIVOS da planilha, com a ficha e a chave com que o frontend os identifica.
 *
 * `padrao` é `chavesCandidatas(nome)[1] ?? [0]` — exatamente o que `buildProjetosIndex` usa para
 * montar `index.ativos`. É a chave da junção: se divergir, o card não acha o resumo.
 */
export function clientesAtivos(rows) {
  const grupos = new Map();
  for (const r of rows) {
    const nome = r.cliente?.trim();
    if (!nome) continue;
    const k = chavesCandidatas(nome)[0];
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  }

  const out = [];
  const vistos = new Set();
  for (const rs of grupos.values()) {
    if (!rs.some((r) => ehAtivo(r.status))) continue;
    const nome = rs.map((r) => r.cliente?.trim()).find((n) => n) ?? "";
    const cands = chavesCandidatas(nome);
    const padrao = cands[1] ?? cands[0];
    if (!padrao || vistos.has(padrao)) continue;
    vistos.add(padrao);

    // Campo vazio na linha de referência cai para outra linha do mesmo cliente: é comum a planilha
    // só preencher líder/plano numa delas.
    const ordenadas = [...rs].sort((a, b) => (ehAtivo(b.status) ? 1 : 0) - (ehAtivo(a.status) ? 1 : 0));
    const desde = rs
      .map((r) => r.data_inicio)
      .filter(Boolean)
      .sort()[0] ?? null;

    out.push({
      padrao,
      chaves: cands,
      nome,
      plano: ordenadas.map((r) => r.plano?.trim()).find((p) => p) || null,
      squad: ordenadas.map((r) => r.lider_revops?.trim()).find((s) => s) || null,
      desde,
      temCRM: rs.some((r) => /^sim/i.test(String(r.crm || "").trim()))
        ? true
        : rs.some((r) => /^n[ãa]o/i.test(String(r.crm || "").trim()))
          ? false
          : null,
    });
  }
  out.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return out;
}

/** Meses completos de casa. */
export function mesesDeCasa(desde, hoje = new Date()) {
  if (!desde) return null;
  const d = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  let m = (hoje.getFullYear() - d.getFullYear()) * 12 + (hoje.getMonth() - d.getMonth());
  if (hoje.getDate() < d.getDate()) m -= 1;
  return Math.max(0, m);
}

// `metricasDe` (soma das chaves candidatas do cliente) saiu daqui junto com a métrica do resumo.
// Quem ainda precisa dela é o Ad Composer, que tem a sua própria em `composer.js` — o resumo não
// fala mais de número, então manter uma cópia morta aqui só daria a impressão de que fala.

/**
 * Um período inteiro sem NENHUM evento de CRM em NENHUM cliente não é um mês fraco: é a leitura
 * tendo voltado vazia. Acontece silenciosamente quando se lê uma view com predicado de tenancy
 * embutido usando service_role — ver o comentário de `readCrmAgg`. Melhor falhar alto do que
 * escrever dezenas de resumos dizendo que todo mundo parou.
 */
function assertMetricasVivas(crmRows, adsRows) {
  if (crmRows.length === 0 && adsRows.length === 0) {
    throw new Error(
      "Nenhuma linha de CRM nem de anúncios no período. Provável leitura vazia por RLS/tenancy " +
        "(service_role não tem auth.uid()): confira se `mv_kommo_crm_agg` e `v_meta_google_ads` " +
        "devolvem linhas para a service_role antes de culpar os dados."
    );
  }
}

function sessionId(padrao) {
  const short = createHash("sha256").update(`${padrao}:${Date.now()}`).digest("hex").slice(0, 16);
  // Mesma receita do spy: sessão nova por execução (sessão viva reaproveitada faz o Gateway
  // abortar o turno em andamento) e teto de 64 chars.
  return `brief-${short}`;
}

/**
 * Quem está ATIVO e com que especialidade. Sem número nenhum.
 *
 * É o que o Contexto Operacional precisa, e só. Separar isto da leitura de métrica não é arrumação:
 * `assertMetricasVivas` roda ANTES de qualquer cliente ser escrito, então enquanto as duas coisas
 * vinham juntas uma leitura de CRM vazia — por RLS, por tenancy, por a materialized view estar no
 * meio de um refresh — abortava o job semanal INTEIRO. O resumo não usa mais esses números para
 * nada; deixá-lo morrer por causa deles seria dar poder de veto a um dado que ele não lê.
 */
export async function coletarFichas() {
  const [projetos, especialidades] = await Promise.all([
    readProjetosLista(),
    readEspecialidades(),
  ]);

  // Planilha vazia não é "nenhum cliente ativo": é leitura falhando. Melhor gritar do que apagar
  // a carteira inteira gravando resumo de ninguém.
  if (projetos.length === 0) {
    throw new Error(
      "`projetos_lista` voltou vazia. Sem a planilha não há como saber quem está ativo — " +
        "confira a leitura antes de culpar os dados."
    );
  }

  const espPor = new Map();
  for (const e of especialidades) {
    const k = clientMatchKey(e.nome_identificador);
    if (k && Array.isArray(e.especialidades)) espPor.set(k, e.especialidades);
  }

  /**
   * NENHUMA especialidade para NENHUM cliente não é "ninguém cadastrou": é a leitura tendo voltado
   * vazia. Foi o estado normal do worker até 28/09/2026, porque `v_cliente_especialidades` embute
   * `is_approved(auth.uid())` na definição da VIEW — e predicado de view não é RLS, então nem
   * service_role passa por cima dele. Hoje a leitura vai pela RPC `especialidades_clientes_worker`,
   * que espelha a view sem o portão; se ESTA flag acender, ou a migração não rodou (o `db.js` avisa
   * com o nome do arquivo) ou a carteira realmente está sem cadastro.
   *
   * A flag existe de qualquer jeito porque a consequência não mudou: sem ela o resumo afirmaria,
   * cliente por cliente, que não há especialidade cadastrada — o que é falso e a tela desmente na
   * hora, com as tags do card.
   */
  const especialidadesIndisponiveis = espPor.size === 0;

  return { clientes: clientesAtivos(projetos), espPor, especialidadesIndisponiveis };
}

/**
 * As fichas MAIS os números das duas semanas fechadas.
 *
 * ⚠️ **SEM USUÁRIO em produção desde 02/10/2026.** O Ad Composer era o último, e o insumo "números
 * da semana fechada" saiu dele: quem leva número à composição agora é o Relatório, com o período
 * que a pessoa escolheu e as metas e correções que a tela aplica. O Contexto Operacional não fala
 * de número, e o Relatório recebe os dele prontos.
 *
 * Fica aqui, com os testes, porque a máquina de semana fechada (`semanasFechadas`, `agregar`,
 * `assertMetricasVivas`) é cara de reconstruir e tem chance real de ser pedida de novo. Mas é código
 * sem chamador: se daqui a alguns meses ninguém a tiver usado, apagar é o certo — e este aviso é o
 * que impede alguém de assumir que ela está em uso só porque existe.
 */
export async function coletarComMetricas({ agora = new Date() } = {}) {
  const semana = semanasFechadas(agora);
  const [fichas, basisPor, crmAtual, adsAtual, crmAnterior, adsAnterior] = await Promise.all([
    coletarFichas(),
    readFaturamentoConfig(),
    readCrmAgg({ de: semana.de, ate: semana.ate }),
    readAdsRows({ de: semana.de, ate: semana.ate }),
    readCrmAgg({ de: semana.deAnterior, ate: semana.ateAnterior }),
    readAdsRows({ de: semana.deAnterior, ate: semana.ateAnterior }),
  ]);

  assertMetricasVivas(crmAtual, adsAtual);

  return {
    ...fichas,
    semana,
    // Qual das duas leituras trouxe linha. Uma fonte que voltou vazia para a CARTEIRA INTEIRA não é
    // "ninguém investiu": é a leitura que falhou, e quem usa os números precisa mostrar travessão
    // em vez de zero. `assertMetricasVivas` só pega o caso em que as duas vêm vazias juntas.
    fontes: { crm: crmAtual.length > 0, ads: adsAtual.length > 0 },
    atual: agregar({ crmRows: crmAtual, adsRows: adsAtual, basisPor }),
    anterior: agregar({ crmRows: crmAnterior, adsRows: adsAnterior, basisPor }),
  };
}

/**
 * Escreve (ou reescreve) o Contexto Operacional de UM cliente.
 *
 * `semana` entra por parâmetro para o job inteiro gravar a MESMA semana: `semanasFechadas()` é pura,
 * mas uma execução que atravesse a meia-noite de domingo mudaria de janela no meio da carteira.
 */
export async function refreshBrief({
  cliente,
  userId = null,
  log = () => {},
  dados = null,
  semana = semanasFechadas(),
}) {
  const d = dados || (await coletarFichas());
  const ficha = d.clientes.find((c) => c.padrao === cliente);
  if (!ficha) throw new Error(`Cliente "${cliente}" não está na lista de ativos da planilha.`);

  const especialidades = ficha.chaves.map((k) => d.espPor.get(k)).find((v) => v?.length) || [];

  const content = buildBriefPrompt({
    ficha: {
      nome: ficha.nome,
      especialidades,
      plano: ficha.plano,
      squad: ficha.squad,
      desde: ficha.desde,
      mesesDeCasa: mesesDeCasa(ficha.desde),
      temCRM: ficha.temCRM,
      // "não conseguimos ler" e "não tem" são coisas diferentes, e só uma delas pode ser escrita.
      especialidadesIndisponiveis: d.especialidadesIndisponiveis,
    },
  });

  log(`[brief ${ficha.padrao}] chamando ${BRIEF_AGENT_ID}`);
  const { finalText } = await runAgentCli({
    agentId: BRIEF_AGENT_ID,
    content,
    sessionId: sessionId(ficha.padrao),
    timeoutMs: BRIEF_RUN_TIMEOUT_MS,
    log,
  });

  const { briefMd, brief, fontes } = parseBriefReply(finalText);
  await upsertBrief({
    cliente: ficha.padrao,
    nome_exibicao: ficha.nome,
    brief_md: briefMd,
    brief,
    // O Contexto Operacional não fala de número, então não há métrica para guardar junto. Fica `{}`
    // em vez da coluna sair: linhas antigas ainda têm os números da semana que embasaram o texto
    // delas, e apagar isso seria perder a auditoria do que já foi escrito.
    metricas: {},
    fontes,
    status: "ok",
    error: null,
    agent_id: BRIEF_AGENT_ID,
    // Não é mais "a semana analisada": é a semana em que a situação foi apurada. Continua sendo
    // verdade, aparece na tela como "situação apurada em" e é o que mantém `precisaAtualizar`
    // funcionando sem inventar outra regra de pulo.
    semana_de: semana.de,
    semana_ate: semana.ate,
    atualizado_por: userId,
  });
  log(`[brief ${ficha.padrao}] ok${fontes.clickup ? " (com ClickUp)" : " (sem ClickUp)"}`);
  return { cliente: ficha.padrao, fontes };
}

/**
 * Decide se vale gastar uma chamada de agente por este cliente.
 *
 * O ClickUp de um cliente não muda tanto em sete dias que valha uma segunda chamada de agente no
 * mesmo job semanal. `semana_ate` é a semana em que a situação foi apurada, e comparar por ela dá
 * retomada de graça: um job que morreu no meio roda de novo e só pega quem faltou. Entra quem:
 *   - nunca foi apurado, ou
 *   - foi apurado numa semana anterior (a janela virou), ou
 *   - terminou em erro (é justamente quem precisa de nova tentativa).
 *
 * Isto vale só para o job. O "atualizar agora" do card SEMPRE roda, porque o que a pessoa quer ali
 * é reconsultar o ClickUp — esse sim muda dentro da semana.
 */
export function precisaAtualizar(brief, semanaAte) {
  if (!brief) return true;
  if (brief.status !== "ok") return true;
  return brief.semana_ate !== semanaAte;
}

/**
 * Reescreve o resumo de todos os ativos, um de cada vez.
 *
 * Sequencial de propósito: cada resumo carrega um agente, e a caixa também serve o site, o
 * openclaw-bridge e a Mineração. Um cliente que falha NÃO derruba os outros — o erro fica na
 * linha dele, visível na tela.
 *
 * `force` ignora o pulo de quem já está em dia (útil depois de mexer no prompt do agente).
 */
export async function refreshAllBriefs({ log = () => {}, force = false } = {}) {
  const dados = await coletarFichas();
  const semana = semanasFechadas();
  const existentes = new Map(
    (await listBriefs().catch(() => [])).map((b) => [b.cliente, b])
  );

  const alvo = force
    ? dados.clientes
    : dados.clientes.filter((c) => precisaAtualizar(existentes.get(c.padrao), semana.ate));
  const pulados = dados.clientes.length - alvo.length;

  if (dados.especialidadesIndisponiveis) {
    log(
      "[briefs] AVISO: nenhuma especialidade lida. Os resumos sairão sem especialidade. Se a " +
        "linha `rpc/especialidades_clientes_worker indisponível` apareceu acima, falta rodar a " +
        "migração 20260928_especialidades_worker_EXTERNAL.sql."
    );
  }
  log(
    `[briefs] situação apurada na semana de ${semana.de} a ${semana.ate}: ` +
      `${dados.clientes.length} ativo(s), ${alvo.length} a escrever` +
      (pulados ? `, ${pulados} já em dia (pulado(s))` : "")
  );

  let ok = 0;
  const falhas = [];
  for (const c of alvo) {
    try {
      await refreshBrief({ cliente: c.padrao, log, dados, semana });
      ok += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      falhas.push({ cliente: c.padrao, erro: msg });
      log(`[briefs] ${c.padrao} FALHOU: ${msg}`);
      await upsertBrief({
        cliente: c.padrao,
        nome_exibicao: c.nome,
        status: "error",
        error: msg.slice(0, 500),
        agent_id: BRIEF_AGENT_ID,
        semana_de: semana.de,
        semana_ate: semana.ate,
      }).catch(() => {});
    }
  }
  log(`[briefs] fim: ${ok} escrito(s), ${pulados} pulado(s), ${falhas.length} com erro`);
  return { ok, pulados, falhas };
}
