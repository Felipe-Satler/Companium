/**
 * A fronteira de confiança do Relatório: o que o worker aceita do browser e o que ele recalcula.
 *
 * Os números vêm da tela de propósito — é o que faz o relatório concordar com o dashboard. Mas
 * "vem do browser" não é "vale qualquer coisa": forma inválida é recusada em vez de consertada, e o
 * que é barato de recalcular (a janela comparável, o "termina hoje") é recalculado aqui, porque o
 * relógio de uma aba aberta desde ontem não é autoridade sobre que dia é hoje.
 */
import { describe, it, expect } from "vitest";
import { hojeEmSaoPaulo, validarSnapshot } from "../../apps/ad-spy-worker/relatorio.js";

const metrica = (over: Record<string, unknown> = {}) => ({
  id: "leadsCRM",
  label: "Leads CRM",
  unidade: "contagem",
  direcao: "higher",
  grupo: "Leads",
  a: { valor: 48, disponivel: true, corrigido: false },
  b: { valor: 40, disponivel: true, corrigido: false },
  meta: { a: null, b: null },
  delta: { abs: 8, pct: 20, favoravel: "melhorou" },
  ...over,
});

function snap(over: Record<string, unknown> = {}) {
  return {
    versao: 1,
    origem: "frontend",
    periodo: { de: "2026-09-01", ate: "2026-09-30", kind: "month", label: "Setembro 2026" },
    comparacao: { de: "2026-08-01", ate: "2026-08-31", regra: "mes_anterior", dias: 31, comparavel: false },
    metricas: [metrica()],
    avisos: [],
    ...over,
  };
}

// Uma data bem depois do período das fixtures, para "termina hoje" não disparar sozinho.
const DEPOIS = new Date("2026-10-20T12:00:00Z");

describe("validarSnapshot — o que é recusado", () => {
  it("snapshot ausente", () => {
    expect(() => validarSnapshot(null)).toThrow(/ausente/i);
  });

  it("versão desconhecida manda recarregar a página, não adivinha", () => {
    // Frontend e worker em versões diferentes: o campo pode ter mudado de significado.
    expect(() => validarSnapshot(snap({ versao: 99 }))).toThrow(/versões diferentes/i);
  });

  it("data fora de YYYY-MM-DD", () => {
    expect(() => validarSnapshot(snap({ periodo: { de: "01/09/2026", ate: "2026-09-30" } }))).toThrow(
      /YYYY-MM-DD/,
    );
  });

  it("período invertido", () => {
    expect(() =>
      validarSnapshot(snap({ periodo: { de: "2026-09-30", ate: "2026-09-01" } })),
    ).toThrow(/não pode ser antes/i);
  });

  it("período absurdamente longo", () => {
    expect(() =>
      validarSnapshot(snap({ periodo: { de: "2020-01-01", ate: "2026-09-30" } })),
    ).toThrow(/máximo é 400/);
  });

  it("métrica que o worker não conhece é divergência de versão, não dado ruim", () => {
    expect(() => validarSnapshot(snap({ metricas: [metrica({ id: "inventada" })] }))).toThrow(
      /Métrica desconhecida/,
    );
  });

  it("snapshot sem métrica nenhuma", () => {
    expect(() => validarSnapshot(snap({ metricas: [] }))).toThrow(/sem métrica/i);
  });

  it("valor não-finito é recusado — NaN viraria 'null' no JSON e depois 'sem informação'", () => {
    expect(() =>
      validarSnapshot(snap({ metricas: [metrica({ a: { valor: Number.NaN, disponivel: true } })] })),
    ).toThrow(/número finito ou null/);
    expect(() =>
      validarSnapshot(snap({ metricas: [metrica({ a: { valor: "48", disponivel: true } })] })),
    ).toThrow(/número finito ou null/);
  });

  it("snapshot gigante é RECUSADO, nunca truncado", () => {
    // Número cortado inverte conclusão; prosa cortada só degrada. Por isso o Composer trunca e isto
    // não.
    const enorme = snap({ lixo: "x".repeat(200 * 1024) });
    expect(() => validarSnapshot(enorme)).toThrow(/excede o teto/i);
  });

  it("valor null é aceito: é 'não calculável', não erro", () => {
    expect(() =>
      validarSnapshot(snap({ metricas: [metrica({ a: { valor: null, disponivel: true } })] }), {
        agora: DEPOIS,
      }),
    ).not.toThrow();
  });
});

describe("validarSnapshot — o que o worker recalcula", () => {
  it("aceita os números verbatim: não mexe em valor nenhum", () => {
    const entrada = snap();
    const { snapshot } = validarSnapshot(entrada, { agora: DEPOIS });
    expect(snapshot.metricas[0].a.valor).toBe(48);
    expect(snapshot.metricas[0].b.valor).toBe(40);
    expect(snapshot.metricas[0].delta.pct).toBe(20);
  });

  it("calcula os dias do período — o browser não é autoridade nem sobre isso", () => {
    const { snapshot } = validarSnapshot(snap({ periodo: { de: "2026-09-01", ate: "2026-09-30", kind: "month" } }), { agora: DEPOIS });
    expect(snapshot.periodo.dias).toBe(30);
  });

  it("confere a janela comparável e ACUSA divergência sem sobrescrever o número", () => {
    const { snapshot, avisos } = validarSnapshot(
      snap({ comparacao: { de: "2025-01-01", ate: "2025-01-31", regra: "mes_anterior" } }),
      { agora: DEPOIS },
    );
    const aviso = avisos.find((a) => a.codigo === "comparacao_divergente")!;
    expect(aviso).toBeTruthy();
    expect(aviso.detalhe).toContain("2026-08-01");
    // O que a tela mandou continua lá: desempatar reintroduziria a contradição com o dashboard.
    expect(snapshot.comparacao.de).toBe("2025-01-01");
    expect(snapshot.comparacao.conferidaPeloWorker.de).toBe("2026-08-01");
  });

  it("janela coerente não gera aviso", () => {
    const { avisos } = validarSnapshot(snap(), { agora: DEPOIS });
    expect(avisos.find((a) => a.codigo === "comparacao_divergente")).toBeUndefined();
  });

  it("período que termina hoje vira aviso — pelo fuso de São Paulo, não pelo relógio do browser", () => {
    const hoje = hojeEmSaoPaulo(new Date("2026-10-05T12:00:00Z"));
    const { avisos } = validarSnapshot(
      snap({ periodo: { de: "2026-10-01", ate: hoje, kind: "mtd" } }),
      { agora: new Date("2026-10-05T12:00:00Z") },
    );
    expect(avisos.find((a) => a.codigo === "dados_parciais")?.detalhe).toMatch(/hoje ou depois/i);
  });

  it("não duplica o aviso que a tela já mandou", () => {
    const { avisos } = validarSnapshot(
      snap({
        periodo: { de: "2026-10-01", ate: "2026-10-05", kind: "mtd" },
        avisos: [{ codigo: "dados_parciais", metricas: [], detalhe: "já avisado pela tela" }],
      }),
      { agora: new Date("2026-10-05T12:00:00Z") },
    );
    expect(avisos.filter((a) => a.codigo === "dados_parciais")).toHaveLength(1);
  });

  it("período fechado no passado não ganha aviso de dado parcial", () => {
    const { avisos } = validarSnapshot(snap(), { agora: DEPOIS });
    expect(avisos.find((a) => a.codigo === "dados_parciais")).toBeUndefined();
  });

  it("preserva os avisos que a tela mandou", () => {
    const { avisos } = validarSnapshot(
      snap({ avisos: [{ codigo: "sem_meta", metricas: ["consReal"], detalhe: "x" }] }),
      { agora: DEPOIS },
    );
    expect(avisos.find((a) => a.codigo === "sem_meta")).toBeTruthy();
  });
});

describe("hojeEmSaoPaulo", () => {
  it("usa o fuso de São Paulo, não UTC", () => {
    // 02:00 UTC de 06/10 ainda é 05/10 em São Paulo. Sem o fuso, um relatório pedido de madrugada
    // acharia que o período "já fechou".
    expect(hojeEmSaoPaulo(new Date("2026-10-06T02:00:00Z"))).toBe("2026-10-05");
  });
});

/**
 * Criativos no snapshot (bloco `marketing`).
 *
 * O `thumbnail` e o `link` daqui viram `src` e `href` na tela, e o snapshot é GRAVADO — então o
 * esquema é conferido no worker também, não só na origem. A validação da tela protege a tela; esta
 * protege o que ficou no banco e vai ser re-renderizado meses depois.
 */
describe("validarSnapshot — criativos do bloco marketing", () => {
  const criativo = (over: Record<string, unknown> = {}) => ({
    codigo: "V009",
    adId: "9",
    formato: "video",
    objetivo: "geracao_demanda",
    status: "ativo",
    hookRate: 24.08,
    holdRate: 1.03,
    resultados: 96,
    tipoResultado: "Cadastros",
    cpl: 14.26,
    thumbnail: "https://storage.supabase.co/v009.jpg",
    link: "https://www.facebook.com/reel/9",
    gasto: 1369.92,
    impressoes: 40000,
    analise: null,
    ...over,
  });

  const comCriativos = (criativos: unknown[]) =>
    snap({
      marketing: {
        disponivel: true,
        totalAnuncios: criativos.length,
        conta: {},
        criativos,
      },
    });

  it("aceita e preserva os criativos verbatim", () => {
    const { snapshot } = validarSnapshot(comCriativos([criativo()]), { agora: DEPOIS });
    expect(snapshot.marketing.criativos[0].codigo).toBe("V009");
    expect(snapshot.marketing.criativos[0].gasto).toBe(1369.92);
  });

  it("snapshot sem bloco marketing continua válido — o campo é opcional", () => {
    expect(() => validarSnapshot(snap(), { agora: DEPOIS })).not.toThrow();
  });

  it("recusa link ou thumbnail que não seja http(s)", () => {
    expect(() =>
      validarSnapshot(comCriativos([criativo({ link: "javascript:alert(1)" })]), { agora: DEPOIS }),
    ).toThrow(/precisa ser http/i);
    expect(() =>
      validarSnapshot(comCriativos([criativo({ thumbnail: "data:text/html,<script>" })]), { agora: DEPOIS }),
    ).toThrow(/precisa ser http/i);
  });

  it("link ausente é válido: criativo de imagem não tem destino", () => {
    expect(() =>
      validarSnapshot(comCriativos([criativo({ link: null, formato: "estatico" })]), { agora: DEPOIS }),
    ).not.toThrow();
  });

  it("Hook/Hold nulo é válido — estático não tem retenção, e isso não é erro", () => {
    expect(() =>
      validarSnapshot(comCriativos([criativo({ hookRate: null, holdRate: null, cpl: null })]), {
        agora: DEPOIS,
      }),
    ).not.toThrow();
  });

  it("recusa mais criativos que o teto", () => {
    const muitos = Array.from({ length: 25 }, (_, i) => criativo({ adId: String(i) }));
    expect(() => validarSnapshot(comCriativos(muitos), { agora: DEPOIS })).toThrow(/excedem o teto/);
  });

  it("recusa métrica não-finita no criativo", () => {
    expect(() =>
      validarSnapshot(comCriativos([criativo({ gasto: Number.NaN })]), { agora: DEPOIS }),
    ).toThrow(/número finito ou null/);
  });
});
