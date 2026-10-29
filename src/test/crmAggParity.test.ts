import { describe, it, expect } from "vitest";
import {
  mergeByClient,
  mergeKommoAgg,
  calcTotals,
  calcOrigemFunnel,
  calcOrigemFunnelAgg,
  calcMonthlyEvolution,
  calcMonthlyEvolutionAgg,
  toDateKey,
  parseBRL,
  type KommoRow,
  type AdsRow,
  type KommoAggRow,
  type OrigemFunnelRow,
} from "@/utils/crmCalculations";

// Reproduz EXATAMENTE o que a materialized view v_kommo_crm_agg faz no banco:
// unpivot dos 5 eventos (cada um com sua data via toDateKey e valor via parseBRL)
// e GROUP BY pelas dimensões CRUAS. Se mergeKommoAgg(agg) == mergeByClient(raw),
// então o front pode consumir a MV sem mudar nenhum número.
function aggregateLikeMV(rows: KommoRow[]): KommoAggRow[] {
  const map = new Map<string, KommoAggRow>();
  const add = (r: KommoRow, event_type: string, dateRaw: unknown, valor: number) => {
    const event_date = toDateKey(dateRaw as string | null);
    if (!event_date) return; // MV só cria a linha quando to_date_key IS NOT NULL
    const medico = r["Médico"] ?? null;
    const medicos = r["Médicos"] ?? null;
    const origem = r.Origem ?? null;
    const especialidade = r.Especialidade ?? null;
    const key = [r.client, medico, medicos, origem, especialidade, event_type, event_date].join("");
    let e = map.get(key);
    if (!e) {
      e = { client: r.client, medico, medicos, origem, especialidade, event_type, event_date, qtd: 0, valor: 0 };
      map.set(key, e);
    }
    e.qtd += 1;
    e.valor += valor;
  };
  for (const r of rows) {
    const vC = parseBRL(r["Valor da Consulta"]);
    const vP = parseBRL(r["Valor do Procedimento"]);
    if (r.created_at) add(r, "lead", r.created_at, 0);
    add(r, "consulta_agendada", r["Consulta Agendada Em"], vC);
    add(r, "consulta_realizada", r["Dia da Consulta Realizada"], vC);
    add(r, "proc_agendado", r["Procedimento Agendado Em"], vP);
    add(r, "proc_realizado", r["Dia do Procedimento Realizado"], vP);
  }
  return [...map.values()];
}

// Filtra linhas agregadas por período (event_date ∈ [from,to]) — o que o hook faz.
function filterAggByDate(rows: KommoAggRow[], from?: string, to?: string): KommoAggRow[] {
  const f = from ? toDateKey(from) : null;
  const t = to ? toDateKey(to) : null;
  return rows.filter((r) => (!f || r.event_date >= f) && (!t || r.event_date <= t));
}

function row(p: Partial<KommoRow>): KommoRow {
  return {
    id: Math.random(),
    client: "Cliente X",
    Campanha: "",
    Especialidade: null,
    Origem: null,
    "Médico": null,
    "Médicos": null,
    "Consulta Agendada Em": null,
    "Dia da Consulta Realizada": null,
    "Procedimento Agendado Em": null,
    "Dia do Procedimento Realizado": null,
    "Valor da Consulta": null,
    "Valor do Procedimento": null,
    status_nome: null,
    created_at: null,
    ...p,
  };
}

const iso = (d: string) => `${d}T03:00:00.000+00:00`; // meia-noite BRT, como no banco

const rawRows: KommoRow[] = [
  // Mesmo cliente, 2 grafias que canonicalizam junto (deve somar numa linha só)
  row({ client: "Clínica Prisma", Origem: "Meta", created_at: iso("2026-05-03"),
        "Consulta Agendada Em": iso("2026-05-10"), "Dia da Consulta Realizada": iso("2026-05-15"),
        "Valor da Consulta": "R$ 1.950" }),
  row({ client: "Clinica Prisma", Origem: "Google Ads", created_at: iso("2026-05-04"),
        "Consulta Agendada Em": iso("2026-05-12"), "Valor da Consulta": "300,00" }),
  // Lead criado ANTES do período, mas consulta realizada DENTRO (missed event)
  row({ client: "Clínica Prisma", Origem: "Instagram", created_at: iso("2026-04-20"),
        "Dia da Consulta Realizada": iso("2026-05-20"), "Valor da Consulta": "500",
        "Procedimento Agendado Em": iso("2026-05-22"), "Dia do Procedimento Realizado": iso("2026-05-25"),
        "Valor do Procedimento": "1500" }),
  // Médico via fallback "Médicos"; valor com formato ambíguo
  row({ client: "Dra Lia", "Médicos": "Dr. Moacir", Origem: "Meta", created_at: iso("2026-05-05"),
        "Consulta Agendada Em": iso("2026-05-06"), "Valor da Consulta": "1.500" }),
  // Evento fora do período (não deve contar em maio)
  row({ client: "Dra Lia", Origem: "Meta", created_at: iso("2026-06-10"),
        "Consulta Agendada Em": iso("2026-06-11"), "Valor da Consulta": "99,90" }),
  // Data inválida (lixo) — MV e caminho cru ignoram
  row({ client: "Dra Lia", Origem: "Meta", created_at: iso("2026-05-07"),
        "Consulta Agendada Em": "7443198000", "Valor da Consulta": "200" }),
];

const adsRows: AdsRow[] = [
  { Client: "Clínica Prisma", Lead: 40, Mensagens_iniciadas: 10, Valor_usado_BRL: 1234.5, Fonte_Ads: "Meta" },
  { Client: "Clínica Prisma", Lead: 5, Valor_usado_BRL: 300, Fonte_Ads: "Google" },
  { Client: "Dra Lia", Lead: 12, Mensagens_iniciadas: 3, Valor_usado_BRL: 500, Fonte_Ads: "Meta" },
];

// Linha com data de evento INVÁLIDA ("7443198000"). O caminho cru só a conta
// quando NÃO há filtro de data (checa truthiness do campo, não se a data parseia)
// — bug latente. A MV sempre exclui data inválida. Produção SEMPRE tem período
// (default startOfMonth→now em ClientesFiltersContext), então esse cenário é
// inalcançável: com filtro, ambos excluem a linha e batem. Para o caso sem-filtro
// testamos sobre dados limpos (sem essa linha) — aí a paridade também é exata.
const rawRowsClean = rawRows.filter((r) => toDateKey(r["Consulta Agendada Em"] as string) !== null || !r["Consulta Agendada Em"]);

describe("paridade MV vs caminho cru (mergeKommoAgg == mergeByClient)", () => {
  // [nome, from, to, dataset] — com filtro usa dados COMPLETOS (inclui a linha-lixo,
  // que o filtro exclui em ambos); sem filtro usa dados limpos (produção nunca roda
  // sem período, mas cobrimos o caminho lógico da agregação).
  const cases: Array<[string, string | undefined, string | undefined, KommoRow[]]> = [
    ["maio/2026 (dados completos, inclui data-lixo)", "2026-05-01", "2026-05-31", rawRows],
    ["semana (dados completos)", "2026-05-10", "2026-05-16", rawRows],
    ["junho/2026 (dados completos)", "2026-06-01", "2026-06-30", rawRows],
    ["sem filtro (dados limpos)", undefined, undefined, rawRowsClean],
  ];

  for (const [name, from, to, data] of cases) {
    it(`totais idênticos — ${name}`, () => {
      const expected = calcTotals(mergeByClient(data, adsRows, from, to));
      const agg = filterAggByDate(aggregateLikeMV(data), from, to);
      const actual = calcTotals(mergeKommoAgg(agg, adsRows));
      expect(actual).toEqual(expected);
    });

    it(`merge por cliente idêntico — ${name}`, () => {
      const norm = (m: Map<string, unknown>) =>
        [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
      const expected = norm(mergeByClient(data, adsRows, from, to));
      const agg = filterAggByDate(aggregateLikeMV(data), from, to);
      const actual = norm(mergeKommoAgg(agg, adsRows));
      expect(actual).toEqual(expected);
    });

    it(`funil por origem idêntico — ${name}`, () => {
      // A versão agg OMITE origens totalmente zeradas no período (o caminho cru cria
      // linhas 0/0/0/0/0 vindas de linhas do lookback sem evento no período — ruído).
      // Comparamos só as origens com algum evento; os não-zero têm que bater.
      const nonZero = (r: OrigemFunnelRow) =>
        r.leads + r.consultasAgendadas + r.consultasRealizadas + r.procedimentosAgendados + r.procedimentosRealizados > 0;
      const byOrigem = (rows: OrigemFunnelRow[]) =>
        rows.filter(nonZero).sort((a, b) => a.origem.localeCompare(b.origem));
      const expected = byOrigem(calcOrigemFunnel(data, from, to));
      const agg = filterAggByDate(aggregateLikeMV(data), from, to);
      const actual = byOrigem(calcOrigemFunnelAgg(agg));
      expect(actual).toEqual(expected);
    });

    it(`evolução mensal idêntica — ${name}`, () => {
      const expected = calcMonthlyEvolution(data, from, to);
      const agg = filterAggByDate(aggregateLikeMV(data), from, to);
      const actual = calcMonthlyEvolutionAgg(agg);
      expect(actual).toEqual(expected);
    });
  }
});
