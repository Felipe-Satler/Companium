/**
 * Relatório de cliente — DADO COMPARTILHADO entre o frontend e o worker.
 *
 * Mora fora de `src/` e é JavaScript puro pelo mesmo motivo de `shared/ad-formats.js` e de
 * `shared/client-aliases.js`: a tela monta o payload e o worker o valida contra a MESMA definição.
 * Sem isso existiria "métrica que a tela manda e o worker não conhece" — e o worker recusaria um
 * relatório legítimo, ou pior, o aceitaria e o prompt a ignoraria em silêncio.
 *
 * Duas coisas vivem aqui:
 *
 *   1. `METRICAS_RELATORIO` — quais números o relatório analisa, com a DIREÇÃO de cada um. A direção
 *      viaja junto do valor porque o agente não pode ter de deduzir que CPL menor é melhor, e porque
 *      uma linha lida em 2029 precisa ser interpretável sem a tabela de métricas de 2026.
 *   2. `janelaComparavel` — qual é o período de comparação, e POR QUÊ. A regra fica gravada no
 *      relatório: comparar 9 dias com um mês inteiro não é a mesma análise que comparar 9 com 9, e
 *      quem lê depois precisa saber qual das duas foi feita.
 *
 * Os ids e rótulos espelham `METRICS` de `src/components/clientes/crm/CRMComparacaoPeriodos.tsx`, que
 * é a comparação período-a-período que a equipe já usa. Divergir deles faria o relatório e a tela
 * chamarem a mesma coisa por nomes diferentes.
 */

/**
 * @typedef {object} MetricaRelatorio
 * @property {string} id
 * @property {string} label
 * @property {"contagem"|"moeda"|"ratio"} unidade
 * @property {"higher"|"lower"|"neutral"} direcao  higher = maior é melhor; lower = menor é melhor
 * @property {string} [metaKey]  chave em META_FIELDS (src/hooks/useClientesMetas.ts), quando há meta
 * @property {string} grupo
 */

/** @type {MetricaRelatorio[]} */
export const METRICAS_RELATORIO = [
  { id: "leadsCRM", label: "Leads CRM", unidade: "contagem", direcao: "higher", metaKey: "leadsCRM", grupo: "Leads" },
  { id: "leadsTrafego", label: "Leads de tráfego", unidade: "contagem", direcao: "higher", grupo: "Leads" },
  // CPL é derivado (investimento ÷ leads CRM) e a meta dele é um TETO, não um alvo.
  { id: "cplCRM", label: "CPL CRM", unidade: "moeda", direcao: "lower", metaKey: "cplCRM", grupo: "Leads" },
  // Etapa "Orçamento": é aqui que um gargalo de funil costuma aparecer, e sem ela o agente chuta.
  { id: "orcamentoCount", label: "Leads em orçamento", unidade: "contagem", direcao: "higher", grupo: "Orçamento" },
  { id: "orcamentoValor", label: "Valor em orçamento", unidade: "moeda", direcao: "higher", grupo: "Orçamento" },
  { id: "consAgend", label: "Consultas agendadas", unidade: "contagem", direcao: "higher", metaKey: "consultaAgendada", grupo: "Consultas" },
  { id: "consReal", label: "Consultas realizadas", unidade: "contagem", direcao: "higher", metaKey: "consultaRealizada", grupo: "Consultas" },
  { id: "procAgend", label: "Procedimentos agendados", unidade: "contagem", direcao: "higher", metaKey: "procedimentoAgendado", grupo: "Procedimentos" },
  { id: "procReal", label: "Procedimentos realizados", unidade: "contagem", direcao: "higher", metaKey: "procedimentoRealizado", grupo: "Procedimentos" },
  // Investimento é NEUTRO: gastar mais não é bom nem ruim por si: depende do que voltou.
  { id: "investimento", label: "Investimento", unidade: "moeda", direcao: "neutral", metaKey: "investimento", grupo: "Resultado" },
  { id: "faturamento", label: "Faturamento bruto", unidade: "moeda", direcao: "higher", metaKey: "faturamento", grupo: "Resultado" },
  { id: "roas", label: "ROAS", unidade: "ratio", direcao: "higher", metaKey: "roas", grupo: "Resultado" },
];

export const METRICA_IDS = METRICAS_RELATORIO.map((m) => m.id);

export const GRUPOS_RELATORIO = ["Leads", "Orçamento", "Consultas", "Procedimentos", "Resultado"];

export function getMetrica(id) {
  return METRICAS_RELATORIO.find((m) => m.id === id) ?? null;
}

const DIA_MS = 86400000;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/** Parse de `YYYY-MM-DD` como data UTC — sem `new Date(str)` local, que escorrega de fuso. */
function parse(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Quantos dias o período cobre, contando as duas pontas. */
export function diasNoPeriodo(de, ate) {
  const a = parse(de);
  const b = parse(ate);
  if (!a || !b) return null;
  return Math.floor((b.getTime() - a.getTime()) / DIA_MS) + 1;
}

/**
 * O período de comparação, e a justificativa da escolha.
 *
 * A regra tem uma exceção, e as duas partes têm motivo:
 *
 * - **Mês civil (ou mês até hoje) → mês civil anterior.** As metas são cadastradas POR MÊS
 *   (`clientes_meta`), então para um mês o anterior é comparável em tamanho E alinhado com o alvo que
 *   o cliente combinou. "Janela de igual duração" cairia num vão de 30/31 dias atravessando dois
 *   meses, cuja meta pró-rateada é uma mistura de dois alvos — defensável na aritmética e errado no
 *   assunto, porque não é o que ninguém quer dizer com "contra o mês passado".
 * - **Qualquer outro período → janela de igual duração imediatamente anterior.** É a única regra bem
 *   definida para um período arbitrário: 9 dias não têm "mês anterior" análogo. Igual duração deixa
 *   as contagens absolutas comparáveis sem pró-rateio, e ser imediatamente anterior reduz
 *   sazonalidade e mudança de verba.
 *
 * `comparavel` diz se as duas janelas têm o MESMO número de dias. Quando não têm (mês até hoje
 * contra mês fechado), o prompt proíbe comparar absolutos e libera só taxa e razão — é o que a regra
 * "compare apenas períodos e populações compatíveis" exige.
 *
 * @returns {{de: string, ate: string, dias: number, regra: string, motivo: string, comparavel: boolean}|null}
 */
export function janelaComparavel({ de, ate, kind } = {}) {
  const a = parse(de);
  const b = parse(ate);
  if (!a || !b || b.getTime() < a.getTime()) return null;

  const dias = diasNoPeriodo(de, ate);

  if (kind === "month" || kind === "mtd") {
    // Mês civil anterior, inteiro.
    const ano = a.getUTCFullYear();
    const mes = a.getUTCMonth();
    const inicio = new Date(Date.UTC(ano, mes - 1, 1));
    const fim = new Date(Date.UTC(ano, mes, 0)); // dia 0 do mês atual = último dia do anterior
    const diasB = diasNoPeriodo(ymd(inicio), ymd(fim));
    return {
      de: ymd(inicio),
      ate: ymd(fim),
      dias: diasB,
      regra: "mes_anterior",
      motivo:
        kind === "mtd"
          ? "O período é o mês corrente até hoje, e as metas são mensais: a comparação é o mês " +
            "anterior INTEIRO, que tem mais dias — então só taxa e razão são comparáveis."
          : "O período é um mês civil e as metas são mensais, então a comparação é o mês anterior.",
      comparavel: diasB === dias,
    };
  }

  const fim = new Date(a.getTime() - DIA_MS);
  const inicio = new Date(fim.getTime() - (dias - 1) * DIA_MS);
  return {
    de: ymd(inicio),
    ate: ymd(fim),
    dias,
    regra: "janela_igual",
    motivo: `Período de ${dias} dia(s) sem mês civil correspondente: a comparação é a janela de ${dias} dia(s) imediatamente anterior, para as contagens serem comparáveis sem pró-rateio.`,
    comparavel: true,
  };
}
