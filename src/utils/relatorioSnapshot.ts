/**
 * O snapshot que a TELA manda ao worker para o agente escrever o Relatório.
 *
 * Puro e sem hook: recebe o que `useCRMClienteData` e `useClientesMetas` já devolveram, dos dois
 * períodos, e devolve o corpo do POST. Fica testável sem servidor e sem browser.
 *
 * ## Por que os números saem daqui e não do worker
 *
 * Reproduzir o que o dashboard mostra exige três coisas que só o frontend tem: as metas mensais
 * pró-rateadas para a janela (`resolveMeta`), a base de faturamento salva de cada cliente e as
 * correções manuais de `crm_metric_overrides`. Um relatório que contradiz a tela não vale nada, então
 * quem manda o número é quem o exibe — e o worker guarda isso verbatim, para o texto continuar
 * auditável quando os dados de trás já tiverem mudado.
 *
 * ## `disponivel` e `valor: null` são coisas diferentes
 *
 * - `disponivel: false` → a fonte não pôde ser lida. O prompt diz "sem informação".
 * - `disponivel: true, valor: null` → leu, mas o número não é calculável (CPL sem lead nenhum).
 *
 * Nenhum dos dois é zero, e é essa distinção que a spec do relatório exige — `CRMTotals` é número
 * puro, sem nulo, então "não conseguimos ler" chegaria aqui como um `0` confiante se ninguém
 * traduzisse. É o erro mais fácil de cometer em silêncio nesta feature.
 */

import type { CRMTotals } from "@/utils/crmCalculations";
import type { MetaKey, MetaValues } from "@/hooks/useClientesMetas";
import type { CRMOverrideMetric } from "@/utils/crmOverrides";
import { goalPct, goalStatus, isHigherBetter } from "@/utils/metasStatus";
import {
  METRICAS_RELATORIO,
  diasNoPeriodo,
  type DirecaoMetrica,
  type JanelaComparavel,
} from "../../shared/relatorio-metricas";

// Fica em 1: o bloco `marketing` (Hook/Hold + criativos + análise IA) é ADITIVO e o worker o renderiza
// POR PRESENÇA do campo (`snapshot.marketing`), não por versão — então não há bump nem acoplamento de
// deploy. O `relatorio.js` exige `versao === 1`; qualquer combinação de tela/worker antigo↔novo segue
// compatível. Só suba a versão num dia em que houver mudança REALMENTE quebradora de schema.
export const SNAPSHOT_VERSAO = 1;

export type OrcamentoParado = { count: number; valor: number };

export type PontaMetrica = {
  valor: number | null;
  /** false = a fonte não pôde ser lida (≠ de "deu zero"). */
  disponivel: boolean;
  /** true = tem correção manual lançada para este período. */
  corrigido: boolean;
};

export type MetaNaPonta = {
  valor: number | null;
  /** Sempre `clientes_meta:rateio` hoje: a meta é mensal e foi rateada para a janela. */
  origem: string;
  status: "ok" | "off" | "none";
  pct: number | null;
} | null;

export type MetricaSnapshot = {
  id: string;
  label: string;
  unidade: string;
  direcao: DirecaoMetrica;
  grupo: string;
  /** Período analisado. */
  a: PontaMetrica;
  /** Período comparável. `null` quando o relatório é de período simples (sem comparação). */
  b: PontaMetrica | null;
  meta: { a: MetaNaPonta; b: MetaNaPonta };
  delta: { abs: number | null; pct: number | null; favoravel: Favoravel } | null;
};

/** Descreve o período ANALISADO em relação ao comparável — não o contrário. */
export type Favoravel = "melhorou" | "piorou" | "estavel" | "neutro";

export type AvisoSnapshot = { codigo: string; metricas: string[]; detalhe: string };

// ── Bloco de marketing (criativo) ──────────────────────────────────────────────
// Diferente do funil (`metricas`), que vem do CRM: estas métricas vêm da tabela de criativos do Meta
// (`"Criativos Meta Ads"` via useMetaAdsCriativosData) e a análise vem de `meta_ads_ad_analysis`. O
// agente NÃO vê o criativo — a análise é leitura já registrada, tratada como correlação/hipótese.

/** Análise já registrada de um anúncio (robô diário `meta_ads_ad_analysis`). */
export type CriativoAnalise = {
  resumo: string;
  tendencia: string | null;
  positivos: string[];
  melhorar: string[];
  ajustar: string[];
};

/** Entrada crua por anúncio que a tela passa (desacoplada do tipo do hook). */
export type AnuncioMkt = {
  adId: string;
  codigo: string;
  formato: "video" | "estatico" | "desconhecido";
  objetivo: "geracao_demanda" | "seguidores";
  status: "ativo" | "pausado";
  hookRate: number;
  holdRate: number;
  /** Resultado do anúncio pelo tipo DOMINANTE (Cadastros/Conversas/Visitas/Cliques/Seguidores). */
  resultados: number;
  /** Rótulo do tipo de resultado (ex.: "Conversas iniciadas"), para não chamar tudo de "lead". */
  tipoResultado: string;
  /** URL da miniatura do Meta (Thumbnail_URL). null quando não há. */
  thumbnail: string | null;
  /**
   * Destino do clique no criativo: o permalink do vídeo, e só quando existe.
   *
   * Os dois caminhos óbvios estão fechados, testados em 01/10/2026:
   * - **Ad Library não serve.** A URL dela (`/ads/library/?id=`) quer o `ad_archive_id`; o que a base
   *   tem é `Ad_ID`, o id da Ads API. Testado com dois ids reais: responde "No ads match your search
   *   criteria". (O `adLibraryUrl` da Mineração funciona porque lá o `external_id` É o archive id.)
   * - **Ads Manager também não.** Seria o destino mais útil para anúncio próprio, mas o deep link
   *   precisa de `act=<account_id>` e não existe id de conta Meta na base.
   *
   * Para dar link a criativo de IMAGEM a ingestão teria de trazer o `account_id` da conta ou o
   * `effective_object_story_id`/`instagram_permalink_url`. Até então, `null` — e a miniatura aparece
   * sem ser clicável, porque âncora morta sugere que o clique faz algo.
   *
   * Opcional na ENTRADA e obrigatório na saída (`CriativoSnapshot.link`): quem monta pode não ter o
   * campo, mas o snapshot gravado sempre o tem — ainda que `null`.
   */
  link?: string | null;
  gasto: number;
  cliques: number;
  impressoes: number;
};

/** Um criativo já selecionado (melhor/pior) no formato que vai ao agente. */
export type CriativoSnapshot = {
  codigo: string;
  adId: string;
  formato: "video" | "estatico" | "desconhecido";
  objetivo: "geracao_demanda" | "seguidores";
  status: "ativo" | "pausado";
  /** null = sem impressão (sem dado); estático fica ~0 por natureza, não é falha. */
  hookRate: number | null;
  holdRate: number | null;
  /** Resultado pelo tipo dominante + rótulo do tipo. */
  resultados: number;
  tipoResultado: string;
  /** Custo por resultado. null = não calculável (anúncio sem resultado nenhum). */
  cpl: number | null;
  thumbnail: string | null;
  /** Permalink do vídeo, quando existe. `null` = miniatura não clicável (ver `AnuncioMkt.link`). */
  link: string | null;
  gasto: number;
  impressoes: number;
  analise: CriativoAnalise | null;
};

/** Agregado da conta (média ponderada por impressão), só das campanhas de geração de demanda. */
export type MarketingConta = {
  hookRate: number | null;
  holdRate: number | null;
  cliques: number | null;
  cpc: number | null;
  gasto: number | null;
  /** Soma dos resultados (tipos podem se misturar — igual ao dashboard de Meta). */
  resultadosMeta: number | null;
  /** Custo por resultado da conta. null = sem resultado. */
  custoResultadoMeta: number | null;
};

export type MarketingSnapshot = {
  /** false = a fonte de criativos não pôde ser lida (≠ de "não há criativo"). */
  disponivel: boolean;
  totalAnuncios: number;
  conta: MarketingConta;
  /**
   * Anúncios salientes: os de maior volume de resultado + os mais caros por resultado (dedup),
   * ordenados por resultado desc. Uma lista só (não um par melhor/pior): a partição não se sustenta em
   * conta pequena, e o agente identifica vencedor/perdedor pelas métricas. Gastões sem retorno entram
   * garantidos. "Resultado" é o tipo dominante do anúncio (Cadastros/Conversas/…), não só cadastro.
   */
  criativos: CriativoSnapshot[];
};

export type RelatorioSnapshot = {
  versao: number;
  geradoEm: string;
  origem: "frontend";
  escopo: { cliente: string; medico: string; origem: string[]; procedimento: string[] };
  basisFaturamento: { consulta: string; procedimento: string };
  periodo: { de: string; ate: string; dias: number | null; kind: string; label: string };
  /** `null` = período simples (o usuário desligou a comparação na tela). */
  comparacao: (JanelaComparavel & { label: string }) | null;
  metricas: MetricaSnapshot[];
  funil: { orcamentoParado: OrcamentoParado; origem: unknown[] };
  marketing: MarketingSnapshot;
  fontes: { crm: boolean; ads: boolean; metas: boolean; overrides: boolean };
  avisos: AvisoSnapshot[];
};

/**
 * De onde cada métrica sai, e a qual correção manual ela responde.
 *
 * `fonte` decide o `disponivel`: uma leitura de CRM falha não pode apagar o investimento, que vem de
 * outra tabela. `override` é o nome em `CRM_OVERRIDE_METRICS` — quando há correção lançada, a métrica
 * vai marcada, porque o agente não pode descrever número corrigido à mão como tendência observada.
 */
const ORIGEM_METRICA: Record<
  string,
  { fonte: "crm" | "ads" | "ambos"; override?: CRMOverrideMetric[] }
> = {
  leadsCRM: { fonte: "crm", override: ["leads"] },
  leadsTrafego: { fonte: "ads" },
  cplCRM: { fonte: "ambos", override: ["leads"] },
  orcamentoCount: { fonte: "crm" },
  orcamentoValor: { fonte: "crm" },
  consAgend: { fonte: "crm", override: ["consultas_agendadas"] },
  consReal: { fonte: "crm", override: ["consultas_realizadas"] },
  procAgend: { fonte: "crm", override: ["procedimentos_agendados"] },
  procReal: { fonte: "crm", override: ["procedimentos_realizados"] },
  investimento: { fonte: "ads" },
  faturamento: {
    fonte: "crm",
    // Faturamento é recomposto a partir dos valores; qualquer um deles corrigido o afeta.
    override: [
      "valor_consultas_agendadas",
      "valor_consultas_realizadas",
      "valor_procedimentos_agendados",
      "valor_procedimentos_realizados",
    ],
  },
  roas: { fonte: "ambos" },
};

/** O valor de cada métrica dentro de `CRMTotals` + orçamento parado. `null` = não calculável. */
function valorDe(id: string, t: CRMTotals, orc: OrcamentoParado): number | null {
  switch (id) {
    case "leadsCRM":
      return t.leadsCRM;
    case "leadsTrafego":
      return t.leadsTrafego;
    // CPL sem lead nenhum não é zero nem infinito: não existe.
    case "cplCRM":
      return t.leadsCRM > 0 ? t.investimentoTotal / t.leadsCRM : null;
    case "orcamentoCount":
      return orc.count;
    case "orcamentoValor":
      return orc.valor;
    case "consAgend":
      return t.consultasAgendadas;
    case "consReal":
      return t.consultasRealizadas;
    case "procAgend":
      return t.procedimentosAgendados;
    case "procReal":
      return t.procedimentosRealizados;
    case "investimento":
      return t.investimentoTotal;
    case "faturamento":
      return t.faturamentoBruto;
    // Sem investimento não há retorno sobre investimento — nem zero, nem infinito.
    case "roas":
      return t.investimentoTotal > 0 ? t.roas : null;
    default:
      return null;
  }
}

export function favoravelDe(
  direcao: DirecaoMetrica,
  a: number | null,
  b: number | null,
): Favoravel {
  if (direcao === "neutral") return "neutro";
  if (a == null || b == null) return "neutro";
  if (a === b) return "estavel";
  const subiu = a > b;
  return subiu === (direcao === "higher") ? "melhorou" : "piorou";
}

// Volume mínimo para um criativo entrar no diagnóstico: abaixo disso é ruído, não tendência.
const MIN_IMPRESSOES_CRIATIVO = 300;
const TOP_MELHORES = 5;
const TOP_PIORES = 3;

/** Custo por resultado de um anúncio; sem resultado → "infinito" p/ ranquear os piores. */
function cplDe(a: AnuncioMkt): number {
  return a.resultados > 0 ? a.gasto / a.resultados : Number.POSITIVE_INFINITY;
}

/** Média da conta ponderada por impressão (só dos anúncios passados). */
export function agregarMarketingConta(anuncios: AnuncioMkt[]): MarketingConta {
  if (!anuncios.length) {
    return { hookRate: null, holdRate: null, cliques: null, cpc: null, gasto: null, resultadosMeta: null, custoResultadoMeta: null };
  }
  let impr = 0, hook = 0, hold = 0, cliques = 0, gasto = 0, resultados = 0;
  for (const a of anuncios) {
    impr += a.impressoes;
    hook += a.hookRate * a.impressoes;
    hold += a.holdRate * a.impressoes;
    cliques += a.cliques;
    gasto += a.gasto;
    resultados += a.resultados;
  }
  return {
    hookRate: impr > 0 ? hook / impr : null,
    holdRate: impr > 0 ? hold / impr : null,
    cliques,
    cpc: cliques > 0 ? gasto / cliques : null,
    gasto,
    resultadosMeta: resultados,
    custoResultadoMeta: resultados > 0 ? gasto / resultados : null,
  };
}


/**
 * Só `http`/`https` viram link ou `src`.
 *
 * O snapshot é GRAVADO e re-renderizado depois: um `javascript:` guardado aqui viraria XSS no
 * carrossel de quem abrisse o relatório meses adiante. A tela valida para proteger a tela; o worker
 * revalida para proteger o que ficou no banco.
 */
function urlSegura(url: string | null | undefined): string | null {
  const v = String(url ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

function toCriativo(a: AnuncioMkt, analises?: Record<string, CriativoAnalise>): CriativoSnapshot {
  return {
    codigo: a.codigo,
    adId: a.adId,
    formato: a.formato,
    objetivo: a.objetivo,
    status: a.status,
    hookRate: a.impressoes > 0 ? a.hookRate : null,
    holdRate: a.impressoes > 0 ? a.holdRate : null,
    resultados: a.resultados,
    tipoResultado: a.tipoResultado,
    cpl: a.resultados > 0 ? a.gasto / a.resultados : null,
    thumbnail: urlSegura(a.thumbnail),
    link: urlSegura(a.link),
    gasto: a.gasto,
    impressoes: a.impressoes,
    analise: (a.adId && analises?.[a.adId]) || null,
  };
}

/**
 * Seleciona melhores/piores criativos e agrega a conta. Só geração de demanda entra (o relatório é de
 * lead), e só acima do piso de impressões — mas se ninguém passa o piso, cai para todos de demanda,
 * para não devolver um bloco vazio quando o cliente é pequeno.
 */
export function montarMarketing(
  disponivel: boolean,
  anuncios: AnuncioMkt[],
  analises?: Record<string, CriativoAnalise>,
  opts?: { topN?: number; piorM?: number; minImpressoes?: number },
): MarketingSnapshot {
  const topN = opts?.topN ?? TOP_MELHORES;
  const piorM = opts?.piorM ?? TOP_PIORES;
  const minImpr = opts?.minImpressoes ?? MIN_IMPRESSOES_CRIATIVO;

  const demanda = anuncios.filter((a) => a.objetivo === "geracao_demanda");
  const comVolume = demanda.filter((a) => a.impressoes >= minImpr);
  const base = comVolume.length ? comVolume : demanda;

  const melhores = [...base].sort((x, y) => y.resultados - x.resultados || cplDe(x) - cplDe(y)).slice(0, topN);
  const escolhidos = new Set(melhores.map((a) => a.adId));
  // Gastões sem retorno / custo mais alto que não estão entre os melhores — garantimos que apareçam.
  const piores = base
    .filter((a) => !escolhidos.has(a.adId) && a.gasto > 0)
    .sort((x, y) => cplDe(y) - cplDe(x))
    .slice(0, piorM);

  // Uma lista só: união dedup, ordenada por resultado desc (melhores no topo, gastões no fim).
  const criativos = [...melhores, ...piores]
    .map((a) => toCriativo(a, analises))
    .sort((x, y) => y.resultados - x.resultados);

  return {
    disponivel,
    totalAnuncios: base.length,
    conta: agregarMarketingConta(base),
    criativos,
  };
}

function metaNaPonta(
  metaKey: string | undefined,
  metas: MetaValues | null,
  real: number | null,
): MetaNaPonta {
  if (!metaKey || !metas) return null;
  const meta = metas[metaKey as MetaKey];
  const valor = meta?.value ?? null;
  if (valor == null) return null;
  return {
    valor,
    // Documenta que o alvo é mensal rateado: sem isso, ninguém entende depois por que a meta de uma
    // janela de 9 dias é 47,3.
    origem: "clientes_meta:rateio",
    status: goalStatus(real, valor, isHigherBetter(metaKey as MetaKey)),
    pct: goalPct(real, valor),
  };
}

export type MontarSnapshotInput = {
  cliente: string;
  periodo: { de: string; ate: string; kind: string; label: string };
  /** `null`/ausente = período simples (sem comparação); então `b` também não vem. */
  comparacao?: (JanelaComparavel & { label: string }) | null;
  a: { totals: CRMTotals; orcamento: OrcamentoParado; metas: MetaValues | null; origemFunnel?: unknown[] };
  b?: { totals: CRMTotals; orcamento: OrcamentoParado; metas: MetaValues | null } | null;
  basisFaturamento: { consulta: string; procedimento: string };
  /** `overrides.get` do período ANALISADO. Ausente = nenhuma correção conhecida. */
  overrideGet?: (m: CRMOverrideMetric) => number | undefined;
  fontes: { crm: boolean; ads: boolean; metas: boolean };
  escopo?: { medico?: string; origem?: string[]; procedimento?: string[] };
  /** Camada de criativo (Meta). Ausente = relatório sem bloco de marketing. */
  marketing?: {
    disponivel: boolean;
    anuncios: AnuncioMkt[];
    analises?: Record<string, CriativoAnalise>;
    opts?: { topN?: number; piorM?: number; minImpressoes?: number };
  };
  agora?: Date;
};

export function montarSnapshot(input: MontarSnapshotInput): RelatorioSnapshot {
  const { cliente, periodo, a, basisFaturamento, overrideGet, fontes } = input;
  // Período simples: sem comparação, o `b` não vem. Tudo que é da ponta B fica null.
  const comparacao = input.comparacao ?? null;
  const b = comparacao ? input.b ?? null : null;
  const agora = input.agora ?? new Date();
  const diasA = diasNoPeriodo(periodo.de, periodo.ate);

  const corrigidas = new Set<string>();
  const metricas: MetricaSnapshot[] = METRICAS_RELATORIO.map((m) => {
    const origem = ORIGEM_METRICA[m.id] ?? { fonte: "crm" as const };
    const lida =
      origem.fonte === "crm"
        ? fontes.crm
        : origem.fonte === "ads"
          ? fontes.ads
          : fontes.crm && fontes.ads;

    const corrigido = Boolean(overrideGet && origem.override?.some((o) => overrideGet(o) !== undefined));
    if (corrigido) corrigidas.add(m.id);

    const valorA = lida ? valorDe(m.id, a.totals, a.orcamento) : null;
    const valorB = b && lida ? valorDe(m.id, b.totals, b.orcamento) : null;

    return {
      id: m.id,
      label: m.label,
      unidade: m.unidade,
      direcao: m.direcao,
      grupo: m.grupo,
      a: { valor: valorA, disponivel: lida, corrigido },
      // A correção é lançada por período: marcar a ponta B com a de A seria mentira.
      b: b ? { valor: valorB, disponivel: lida, corrigido: false } : null,
      meta: {
        a: metaNaPonta(m.metaKey, a.metas, valorA),
        b: b ? metaNaPonta(m.metaKey, b.metas, valorB) : null,
      },
      delta:
        !b || valorA == null || valorB == null
          ? null
          : {
              abs: valorA - valorB,
              pct: valorB === 0 ? null : ((valorA - valorB) / Math.abs(valorB)) * 100,
              favoravel: favoravelDe(m.direcao, valorA, valorB),
            },
    };
  });

  const avisos: AvisoSnapshot[] = [];

  // O período termina hoje (ou depois): `mv_kommo_crm_agg` é materializada e a cadência de refresh
  // dela não está documentada em lugar nenhum do repositório, então o dado de hoje pode estar
  // incompleto sem dar erro. O agente tem de carregar isso como limitação, não concluir queda.
  const hoje = agora.toISOString().slice(0, 10);
  if (periodo.kind === "mtd" || periodo.ate >= hoje) {
    avisos.push({
      codigo: "dados_parciais",
      metricas: [],
      detalhe:
        "O período termina hoje ou depois: os dados do dia corrente podem estar incompletos. Não " +
        "conclua queda a partir do último dia.",
    });
  }

  if (comparacao && !comparacao.comparavel) {
    avisos.push({
      codigo: "comparacao_incompativel",
      metricas: [],
      detalhe:
        `O período analisado tem ${diasA ?? "?"} dia(s) e o comparável tem ` +
        `${comparacao.dias}. Compare apenas taxas e razões (CPL, ROAS, conversão entre etapas); ` +
        "não compare contagens absolutas.",
    } as AvisoSnapshot);
  }

  const semMeta = metricas.filter((m) => {
    const spec = METRICAS_RELATORIO.find((x) => x.id === m.id);
    return spec?.metaKey && m.meta.a === null;
  });
  if (semMeta.length) {
    avisos.push({
      codigo: "sem_meta",
      metricas: semMeta.map((m) => m.id),
      detalhe: "Sem meta cadastrada para o período — não fale de desvio em relação à meta nestas.",
    });
  }

  if (corrigidas.size) {
    avisos.push({
      codigo: "override_aplicado",
      metricas: [...corrigidas],
      detalhe:
        "Número com correção manual lançada no CRM para este período. Ele é o número oficial, mas " +
        "não é observação de campo: não o descreva como tendência medida.",
    });
  }

  if (!fontes.metas) {
    avisos.push({
      codigo: "metas_indisponiveis",
      metricas: [],
      detalhe: "As metas não puderam ser lidas nesta execução — não afirme que não há meta.",
    });
  }

  const marketing: MarketingSnapshot = input.marketing
    ? montarMarketing(
        input.marketing.disponivel,
        input.marketing.anuncios,
        input.marketing.analises,
        input.marketing.opts,
      )
    : { disponivel: false, totalAnuncios: 0, conta: agregarMarketingConta([]), criativos: [] };

  if (!marketing.disponivel) {
    avisos.push({
      codigo: "criativos_indisponiveis",
      metricas: [],
      detalhe:
        "As métricas por criativo (Hook/Hold e desempenho por anúncio) não puderam ser lidas nesta " +
        "execução — não afirme nada sobre criativo.",
    });
  } else if (marketing.totalAnuncios === 0) {
    avisos.push({
      codigo: "sem_criativos",
      metricas: [],
      detalhe:
        "Nenhum anúncio de geração de demanda no período — não há desempenho por criativo a analisar.",
    });
  }

  return {
    versao: SNAPSHOT_VERSAO,
    geradoEm: agora.toISOString(),
    origem: "frontend",
    escopo: {
      cliente,
      medico: input.escopo?.medico ?? "",
      origem: input.escopo?.origem ?? [],
      procedimento: input.escopo?.procedimento ?? [],
    },
    basisFaturamento,
    periodo: { ...periodo, dias: diasA },
    comparacao,
    metricas,
    funil: { orcamentoParado: a.orcamento, origem: a.origemFunnel ?? [] },
    marketing,
    fontes: { ...fontes, overrides: corrigidas.size > 0 },
    avisos,
  };
}
