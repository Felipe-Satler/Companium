/**
 * A divisão de `coletar()` em `coletarFichas()` e `coletarComMetricas()`.
 *
 * Setembro de 2026: o Contexto Operacional parou de falar de número, e a leitura de métrica saiu do
 * caminho dele. Não é arrumação — é comportamento. `assertMetricasVivas` roda DENTRO da coleta, antes
 * de qualquer cliente ser escrito, então enquanto as duas coisas vinham juntas uma leitura de CRM
 * vazia (RLS, tenancy, materialized view em refresh) abortava o job semanal INTEIRO por causa de um
 * dado que o resumo não lê mais.
 *
 * O teste que importa aqui é o negativo: `coletarFichas()` **não pode** tocar no CRM. Se alguém
 * reunir as duas funções de novo, é ele que acusa — nada mais no repositório notaria.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const readCrmAgg = vi.fn();
const readAdsRows = vi.fn();
const readProjetosLista = vi.fn();
const readEspecialidades = vi.fn();
const readFaturamentoConfig = vi.fn();

vi.mock("../../apps/ad-spy-worker/db.js", () => ({
  readCrmAgg: (...a: unknown[]) => readCrmAgg(...a),
  readAdsRows: (...a: unknown[]) => readAdsRows(...a),
  readProjetosLista: (...a: unknown[]) => readProjetosLista(...a),
  readEspecialidades: (...a: unknown[]) => readEspecialidades(...a),
  readFaturamentoConfig: (...a: unknown[]) => readFaturamentoConfig(...a),
  listBriefs: vi.fn(),
  upsertBrief: vi.fn(),
}));

import { coletarFichas, coletarComMetricas } from "../../apps/ad-spy-worker/briefs.js";

const PLANILHA = [
  {
    cliente: "Dr. José Ramos - VascuMed",
    status: "ATIVO",
    plano: "Escala",
    lider_revops: "Marina",
    data_inicio: "2025-03-01",
    crm: "sim",
  },
  { cliente: "Clínica Fechada", status: "INATIVO", plano: null, lider_revops: null, crm: "não" },
];

beforeEach(() => {
  vi.clearAllMocks();
  readProjetosLista.mockResolvedValue(PLANILHA);
  readEspecialidades.mockResolvedValue([
    { nome_identificador: "jose_ramos", especialidades: ["Cirurgia Vascular"] },
  ]);
  readFaturamentoConfig.mockResolvedValue(new Map());
  // O CRM (Kommo) guarda o nome SEM o pronome de tratamento; a conta de anúncio guarda COM ("Dr. ").
  // Essa assimetria é a razão de existir do `client-match.js`, e é por isso que a fixture usa as duas
  // grafias: com a mesma string nas duas pontas, o teste passaria sem provar o casamento.
  readCrmAgg.mockResolvedValue([
    { client: "José Ramos - VascuMed", event_type: "lead", qtd: 48, valor: 0 },
    { client: "José Ramos - VascuMed", event_type: "consulta_agendada", qtd: 11, valor: 9000 },
  ]);
  readAdsRows.mockResolvedValue([
    { Client: "Dr. José Ramos - VascuMed", Lead: 30, Mensagens_iniciadas: 2, Valor_usado_BRL: 3000 },
  ]);
});

describe("coletarFichas", () => {
  it("NÃO lê CRM nem anúncios — é o que impede uma leitura vazia de derrubar o job semanal", async () => {
    await coletarFichas();
    expect(readProjetosLista).toHaveBeenCalledOnce();
    expect(readEspecialidades).toHaveBeenCalledOnce();
    expect(readCrmAgg).not.toHaveBeenCalled();
    expect(readAdsRows).not.toHaveBeenCalled();
    expect(readFaturamentoConfig).not.toHaveBeenCalled();
  });

  it("devolve a carteira ativa com a chave que o frontend usa, e sem número", async () => {
    const d = await coletarFichas();
    expect(d.clientes.map((c) => c.padrao)).toEqual(["jose_ramos"]);
    expect(d.espPor.get("jose_ramos")).toEqual(["Cirurgia Vascular"]);
    expect(d.especialidadesIndisponiveis).toBe(false);
    // Sem métrica nenhuma no objeto: o resumo não tem o que citar mesmo que o prompt vazasse.
    expect(d).not.toHaveProperty("atual");
    expect(d).not.toHaveProperty("semana");
  });

  it("planilha vazia é leitura falhando, não carteira vazia", async () => {
    readProjetosLista.mockResolvedValue([]);
    await expect(coletarFichas()).rejects.toThrow(/projetos_lista.*vazia/i);
  });

  it("CRM fora do ar não impede o Contexto Operacional", async () => {
    // O cenário exato que abortava tudo antes da divisão.
    readCrmAgg.mockRejectedValue(new Error("RLS devolveu vazio"));
    readAdsRows.mockRejectedValue(new Error("RLS devolveu vazio"));
    const d = await coletarFichas();
    expect(d.clientes).toHaveLength(1);
  });
});

describe("coletarComMetricas", () => {
  it("é o caminho do Ad Composer: ficha + semana fechada + números", async () => {
    const d = await coletarComMetricas({ agora: new Date("2026-09-16T12:00:00Z") });
    expect(d.clientes.map((c) => c.padrao)).toEqual(["jose_ramos"]);
    expect(d.semana).toEqual({
      de: "2026-09-07",
      ate: "2026-09-13",
      deAnterior: "2026-08-31",
      ateAnterior: "2026-09-06",
    });
    // O agregado é indexado por CHAVE DE CASAMENTO, não pelo `padrao` — daí o Composer somar todas
    // as `chaves` candidatas do cliente (médico e clínica). É este número que vai a ele como contexto
    // de tom: vindo vazio, a composição afirma que não há dado quando há.
    const chaves = d.clientes[0].chaves;
    const m = chaves.map((k: string) => d.atual.get(k)).find(Boolean);
    expect(m?.investimento).toBe(3000);
    expect(m?.leadsCRM).toBe(48);
    expect(m?.leadsTrafego).toBe(32);
  });

  it("leitura de métrica vazia AINDA grita aqui — para o Composer isso é bug, não silêncio", async () => {
    readCrmAgg.mockResolvedValue([]);
    readAdsRows.mockResolvedValue([]);
    await expect(coletarComMetricas()).rejects.toThrow(/Nenhuma linha de CRM/i);
  });
});
