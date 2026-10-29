// Conceitos Estratégicos do Composer (20/10/2026): a lógica pura (catálogo, trechos, unicidade,
// reciclagem, avisos) e a condução da etapa, com o agente e o banco trocados por dublês.
//
// O que se protege aqui é a promessa central da etapa: dois anúncios de uma composição NUNCA saem
// com o mesmo conceito (a Meta os trataria como o mesmo anúncio), a não ser na reciclagem que quem
// compõe pediu — e aí nunca no mesmo formato de saída. E que o agente não inventa ângulo: todo
// ângulo cita trecho que existe no Estudo.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const runAgentCli = vi.fn();
const patchComposition = vi.fn();
const getComposition = vi.fn();
const getCriativo = vi.fn();
const conteudoDoDocumento = vi.fn();
const listClientDocPages = vi.fn();

vi.mock("../../apps/ad-spy-worker/agent-cli.js", () => ({
  runAgentCli: (...a: unknown[]) => runAgentCli(...a),
}));
vi.mock("../../apps/ad-spy-worker/config.js", () => ({
  COMPOSER_AGENT_ID: "composeragent",
  COMPOSER_RUN_TIMEOUT_MS: 1000,
  MAX_COMPOSER_CHARS: 80000,
}));
vi.mock("../../apps/ad-spy-worker/briefs.js", () => ({
  coletarFichas: async () => ({
    clientes: [{ padrao: "otavio", nome: "Dr. Otavio Brandt", chaves: [], plano: "Escala" }],
    espPor: new Map(),
  }),
  mesesDeCasa: () => 6,
}));
vi.mock("../../apps/ad-spy-worker/clickup.js", () => ({
  conteudoDoDocumento: (...a: unknown[]) => conteudoDoDocumento(...a),
}));
vi.mock("../../apps/ad-spy-worker/db.js", () => ({
  getBrief: async () => null,
  getLibraryEntry: async () => null,
  getReport: async () => null,
  patchComposition: (...a: unknown[]) => patchComposition(...a),
  getComposition: (...a: unknown[]) => getComposition(...a),
  getCriativo: (...a: unknown[]) => getCriativo(...a),
  listClientDocPages: (...a: unknown[]) => listClientDocPages(...a),
}));

import {
  avisosDoConceito,
  blocoDoConceito,
  buildConceitosPrompt,
  catalogoInicial,
  chaveDoConceito,
  distribuirConceitos,
  incorporarAngulos,
  normalizarConceito,
  parseConceitosReply,
  trechoExiste,
  normalizarTexto,
  validarConceito,
} from "../../apps/ad-spy-worker/conceitos.js";
import {
  AcaoInvalida,
  aprovar,
  gerarConceito,
  rejeitar,
  runConceitos,
  seguirAssimMesmo,
} from "../../apps/ad-spy-worker/composer-conceitos.js";
import { montarMaterial, runComposition } from "../../apps/ad-spy-worker/composer.js";
import { buildAnuncioPrompt } from "../../apps/ad-spy-worker/composer-prompt.js";
import { destravarConceitos, MOTIVO_CONCEITO_INTERROMPIDO, MOTIVO_REINICIO } from "../../apps/ad-spy-worker/orfas.js";

const ESTUDO_MD = fs.readFileSync(path.resolve(__dirname, "fixtures/estudo-copy-exemplo.txt"), "utf-8");
const ESTUDO = { page_id: "p-estudo", nome: "Estudo de Copy – Tricologia - Dr. Otavio Brandt", conteudo_md: ESTUDO_MD, estudo: true };

const criativo = (id: string, titulo: string, nivel = "consciente_solucao") => ({
  id,
  titulo,
  status: "done",
  ad: { page_name: "Concorrente" },
  dissecacao: {
    versao: 2,
    formato: "Vídeo vertical",
    estrutura: "Qualifica → Destrói a solução atual",
    anatomia_semantica: "",
    anatomia_psicologica: "",
    nivel_consciencia: nivel,
    blocos: [{ n: 1, nome: "Chama e qualifica o público" }],
    movimentos: [{ n: 1, nome: "Qualifica", como_funciona: "Nomeia uma situação que só quem tem o problema reconhece.", bloco: 1 }],
    ligacoes: true,
  },
  dissecacao_md: "",
});
const CRIATIVOS = [
  criativo("11111111-1111-4111-8111-111111111111", "Sem raspar"),
  criativo("22222222-2222-4222-8222-222222222222", "Antes de desistir", "consciente_problema"),
];

// Trechos LITERAIS do Estudo (com a pontuação e os acentos trocados de propósito em um deles).
const TRECHO_NO_SHAVE = "Preserva o comprimento original dos fios";
const TRECHO_RASPAR = "panico de ter que raspar a cabeca a zero";
const TRECHO_BONE = "Usa boné nos finais de semana";

const ANGULOS = [
  { id: "G1", nome: "Sem raspar a cabeça", descricao: "Medo de aparecer raspado × No Shave", trechos: [TRECHO_RASPAR, TRECHO_NO_SHAVE] },
  { id: "G2", nome: "O boné como esconderijo", descricao: "", trechos: [TRECHO_BONE] },
];

const catalogoComAngulos = () =>
  incorporarAngulos(catalogoInicial({ estudo: ESTUDO, criativos: CRIATIVOS }), ANGULOS, ESTUDO_MD).catalogo;

const conceito = (over: Record<string, string> = {}) =>
  normalizarConceito({ avatar: "A1", nivel: "consciente_solucao", angulo: "G1", criativo: "C1", justificativa: "x", ...over });

describe("catálogo do Estudo de Copy", () => {
  it("lê avatares, assinatura, RQE e preço do Estudo, e numera os formatos", () => {
    const c = catalogoInicial({ estudo: ESTUDO, criativos: CRIATIVOS });
    expect(c.avatares.map((a) => a.id)).toEqual(["A1", "A2", "A3"]);
    expect(c.assinatura).toBe("Dr. Otavio Lins Brandt | CRM: 00000/MS");
    expect(c.tem_rqe).toBe(false);
    expect(c.estudo_tem_preco).toBe(true);
    expect(c.criativos.map((x) => [x.id, x.nome, x.nivel])).toEqual([
      ["C1", "Sem raspar", "consciente_solucao"],
      ["C2", "Antes de desistir", "consciente_problema"],
    ]);
  });
});

describe("trechos dos ângulos", () => {
  const fontes = normalizarTexto(ESTUDO_MD);

  it("casa sem ligar para acento, caixa e pontuação; corta em reticências", () => {
    expect(trechoExiste(TRECHO_RASPAR, fontes)).toBe(true);
    expect(trechoExiste("Sabe perfeitamente que tem calvície... já pesquisou sobre transplante capilar", fontes)).toBe(true);
  });

  it("recusa trecho inventado e trecho curto demais para provar alguma coisa", () => {
    expect(trechoExiste("garantimos resultado em trinta dias", fontes)).toBe(false);
    expect(trechoExiste("cabelo", fontes)).toBe(false);
    // Um pedaço real e um inventado: não passa.
    expect(trechoExiste(`${TRECHO_RASPAR}... e resultado garantido para sempre`, fontes)).toBe(false);
  });

  it("ângulo sem trecho verificável sai; mesmo nome vira o mesmo ângulo; id que colide é renomeado", () => {
    const base = catalogoComAngulos();
    expect(base.angulos.map((a) => a.id)).toEqual(["G1", "G2"]);
    const { catalogo, mapa, descartados } = incorporarAngulos(
      base,
      [
        { id: "G1", nome: "Ângulo inventado", trechos: ["resultado garantido em uma sessão só"] },
        { id: "novo", nome: "sem RASPAR a cabeca", trechos: [TRECHO_NO_SHAVE] },
        { id: "G2", nome: "Ralo cheio de fios", trechos: ["a cada banho, ver o ralo cheio de fios"] },
        { id: "G7", nome: "Rabo de cavalo mais fino", trechos: ["o rabo de cavalo fica mais fino"] },
      ],
      ESTUDO_MD
    );
    expect(descartados).toBe(2); // o inventado e o "ralo", que não está no recorte do fixture
    expect(mapa.get("novo")).toBe("G1");
    expect(mapa.get("G7")).toBe("G3");
    expect(catalogo.angulos.map((a) => a.id)).toEqual(["G1", "G2", "G3"]);
  });
});

describe("unicidade do conceito", () => {
  const catalogo = catalogoComAngulos();

  it("aponta só para o que existe no catálogo", () => {
    const ctx = { catalogo, formatoSaida: "instagram_reels" };
    expect(validarConceito(conceito({ avatar: "A9" }), ctx).motivo).toMatch(/avatar "A9"/);
    expect(validarConceito(conceito({ nivel: "consciente_mecanismo" }), ctx).motivo).toMatch(/nível/);
    expect(validarConceito(conceito({ angulo: "G9" }), ctx).motivo).toMatch(/ângulo "G9"/);
    expect(validarConceito(conceito({ criativo: "C9" }), ctx).motivo).toMatch(/formato "C9"/);
    expect(validarConceito(conceito(), ctx).motivo).toBeNull();
  });

  it("dois anúncios com o mesmo conceito: recusado — basta UMA parte mudar", () => {
    const ocupados = [{ n: 0, chave: chaveDoConceito(conceito()), formato_saida: "instagram_reels" }];
    const ctx = { catalogo, ocupados, formatoSaida: "instagram_stories" };
    expect(validarConceito(conceito(), ctx).motivo).toBe("repete o conceito do anúncio 1");
    expect(validarConceito(conceito({ nivel: "consciente_problema" }), ctx).motivo).toBeNull();
    expect(validarConceito(conceito({ criativo: "C2" }), ctx).motivo).toBeNull();
  });

  it("reciclagem: a mesma chave volta só em OUTRO formato de saída", () => {
    const ocupados = [{ n: 0, chave: chaveDoConceito(conceito()), formato_saida: "instagram_reels" }];
    expect(
      validarConceito(conceito(), { catalogo, ocupados, formatoSaida: "instagram_stories", reciclar: true }),
    ).toEqual({ motivo: null, reciclado: true });
    expect(
      validarConceito(conceito(), { catalogo, ocupados, formatoSaida: "instagram_reels", reciclar: true }).motivo,
    ).toMatch(/mesmo formato de saída/);
  });

  it("conceito rejeitado não volta, em anúncio nenhum", () => {
    const rejeitadas = new Set([chaveDoConceito(conceito())]);
    expect(validarConceito(conceito(), { catalogo, rejeitadas, formatoSaida: "instagram_reels" }).motivo).toMatch(
      /rejeitado/,
    );
  });

  it("na primeira resposta, o segundo conceito igual fica sem conceito, com o motivo", () => {
    const slots = distribuirConceitos({
      formatos: ["instagram_reels", "instagram_stories"],
      conceitosBrutos: [
        { anuncio: 1, avatar: "A1", nivel: "consciente_solucao", angulo: "G1", criativo: "C1" },
        { anuncio: 2, avatar: "A1", nivel: "consciente_solucao", angulo: "G1", criativo: "C1" },
      ],
      mapa: new Map(),
      catalogo,
    });
    expect(slots.map((s) => s.status)).toEqual(["sugerido", "pendente"]);
    expect(slots[1].error).toMatch(/repete o conceito do anúncio 1/);
  });
});

describe("leitura da primeira resposta", () => {
  it("só formatos de saída disponíveis, no teto de 8", () => {
    const anuncios = [
      { formato: "instagram_reels" },
      { formato: "tiktok" }, // registrado, mas indisponível
      { formato: "inventado" },
      ...Array.from({ length: 9 }, () => ({ formato: "meta_ads" })),
    ];
    const r = parseConceitosReply("Ideia.\n```json\n" + JSON.stringify({ anuncios, conceitos: [] }) + "\n```");
    expect(r.formatos).toHaveLength(8);
    expect(r.formatos[0]).toBe("instagram_reels");
    expect(r.formatos).not.toContain("tiktok");
    expect(r.suficiente).toBe(true);
  });
});

describe("o conceito na escrita do anúncio", () => {
  const catalogo = catalogoComAngulos();
  const slots = [
    { n: 0, formato_saida: "instagram_reels", status: "aprovado", conceito: conceito(), reciclado: false, rejeitados: [] },
    { n: 1, formato_saida: "instagram_stories", status: "aprovado", conceito: conceito(), reciclado: true, rejeitados: [] },
  ];

  it("leva avatar, ângulo com trechos, estrutura, funil, assinatura e a trava de RQE", () => {
    const txt = blocoDoConceito({ slot: slots[0], slots, catalogo, criativo: CRIATIVOS[0] });
    expect(txt).toContain("## Avatar: O Empresário/Líder Discreto");
    expect(txt).toContain(`> ${TRECHO_RASPAR}`);
    expect(txt).toContain("Nomeia uma situação que só quem tem o problema reconhece.");
    expect(txt).toContain("no máximo 40 segundos (funil de meio)");
    expect(txt).toContain("Dr. Otavio Lins Brandt | CRM: 00000/MS");
    expect(txt).toMatch(/NÃO tem RQE: nunca o chame de especialista/);
    expect(txt).toMatch(/Preço e condição de pagamento podem entrar, exatamente como o Estudo/);
  });

  it("reciclado diz com qual anúncio divide o conceito", () => {
    const txt = blocoDoConceito({ slot: slots[1], slots, catalogo, criativo: CRIATIVOS[0] });
    expect(txt).toMatch(/também é o do\(s\) anúncio\(s\) 1 \(Instagram Reels\)/);
  });

  it("o prompt de escrita leva o conceito e o Estudo num bloco próprio, fora dos documentos", () => {
    const txt = buildAnuncioPrompt({
      ficha: { nome: "Dr. Otavio" },
      documentos: [ESTUDO, { nome: "Outro", conteudo_md: "texto do outro" }],
      plano: [{ formato: "instagram_reels", angulo: "x" }],
      indice: 0,
      conceito: "# O Conceito Estratégico deste anúncio\nBLOCO",
    });
    expect(txt).toContain("# Estudo de Copy do cliente: Estudo de Copy – Tricologia");
    expect(txt).toContain("# O Conceito Estratégico deste anúncio\nBLOCO");
    expect(txt.match(/Avatar 1: O Empresário/g)).toHaveLength(1);
  });
});

describe("avisos do anúncio escrito", () => {
  const catalogo = catalogoComAngulos();

  it("duração acima do funil, preço, 'especialista' sem RQE e assinatura ausente", () => {
    const roteiro = Array.from({ length: 120 }, () => "palavra").join(" "); // ~48s
    const avisos = avisosDoConceito({
      formatoSaida: "instagram_reels",
      composicao: { roteiro, legenda: "O especialista parcela em 24x sem juros, a partir de R$ 16.000." },
      conceito: conceito(),
      catalogo,
    });
    expect(avisos.map((a) => a.tipo)).toEqual(["duracao_acima_do_funil", "cita_preco", "especialista_sem_rqe", "sem_assinatura"]);
    expect(avisos[0].detalhe).toBe("~48s estimados; o funil de meio pede até 40s");
  });

  it("vídeo dentro do funil, com assinatura e sem preço: nenhum aviso", () => {
    const avisos = avisosDoConceito({
      formatoSaida: "instagram_reels",
      composicao: { roteiro: "Fala curta. Dr. Otavio Lins Brandt | CRM: 00000/MS" },
      conceito: conceito(),
      catalogo,
    });
    expect(avisos).toEqual([]);
  });

  it("formato que não é vídeo não cobra assinatura", () => {
    expect(
      avisosDoConceito({ formatoSaida: "meta_ads", composicao: { primary_text: "Texto" }, conceito: conceito(), catalogo }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// A condução da etapa, com dublês
// ---------------------------------------------------------------------------------------------

const resposta = (obj: unknown, prosa = "A ideia do conjunto.") => `${prosa}\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;

/** Um banco de uma linha e um agente que responde o que o teste enfileirar. */
function dubles(linha: Record<string, unknown>, respostas: string[], material = { estudo: ESTUDO, criativos: CRIATIVOS }) {
  let atual = structuredClone(linha);
  const perguntas: string[] = [];
  const agendados: number[] = [];
  const deps = {
    material: async () => ({
      ctx: { ficha: { nome: "Dr. Otavio Brandt", especialidades: ["Tricologia"] } },
      material: { documentos: material.estudo ? [material.estudo] : [], criativos: material.criativos },
    }),
    perguntar: async (content: string) => {
      perguntas.push(content);
      const r = respostas.shift();
      if (r === undefined) throw new Error("agente sem resposta enfileirada");
      return r;
    },
    ler: async () => structuredClone(atual),
    gravar: async (patch: Record<string, unknown>) => {
      atual = { ...atual, ...structuredClone(patch) };
    },
    agendar: (n: number) => agendados.push(n),
  };
  return { deps, perguntas, agendados, linha: () => atual };
}

const PRIMEIRA = {
  anuncios: [{ formato: "instagram_reels" }, { formato: "instagram_stories" }],
  angulos: ANGULOS,
  conceitos: [
    { anuncio: 1, avatar: "A1", nivel: "consciente_solucao", angulo: "G1", criativo: "C1", justificativa: "a" },
    { anuncio: 2, avatar: "A2", nivel: "consciente_problema", angulo: "G2", criativo: "C2", justificativa: "b" },
  ],
  suficiente: true,
};

describe("runConceitos — a primeira sugestão", () => {
  it("sugere um conceito por anúncio, com o catálogo e a prosa do conjunto", async () => {
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, [resposta(PRIMEIRA)]);
    await runConceitos({ id: "k1", extraPrompt: "um Reels e um Stories", deps: d.deps });
    expect(d.perguntas[0].split("\n")[0]).toBe("## Modo: conceitos estratégicos");
    expect(d.perguntas[0]).toContain("## A1 — O Empresário/Líder Discreto");
    expect(d.perguntas[0]).toContain("## C1 — Sem raspar");
    const l = d.linha();
    expect((l.conceitos as { status: string }[]).map((s) => s.status)).toEqual(["sugerido", "sugerido"]);
    expect((l.catalogo_copy as { angulos: unknown[] }).angulos).toHaveLength(2);
    expect(l.insumos_insuficientes).toBeNull();
    expect(l.composicao_md).toBe("A ideia do conjunto.");
    expect(d.agendados).toEqual([]);
  });

  it("material suficiente e uma sugestão repetida: o anúncio é pedido de novo, já", async () => {
    const repetida = { ...PRIMEIRA, conceitos: [PRIMEIRA.conceitos[0], { ...PRIMEIRA.conceitos[0], anuncio: 2 }] };
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, [resposta(repetida)]);
    await runConceitos({ id: "k1", deps: d.deps });
    expect((d.linha().conceitos as { status: string }[]).map((s) => s.status)).toEqual(["sugerido", "gerando"]);
    expect(d.agendados).toEqual([1]);
  });

  it("material insuficiente: entrega o que conseguiu e espera quem compõe decidir", async () => {
    const pouca = {
      ...PRIMEIRA,
      conceitos: [PRIMEIRA.conceitos[0]],
      suficiente: false,
      falta: "O Estudo só sustenta um ângulo para Stories.",
      sugestao: "Escolha outra análise de criativo.",
    };
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, [resposta(pouca)]);
    await runConceitos({ id: "k1", deps: d.deps });
    const l = d.linha();
    expect((l.conceitos as { status: string }[]).map((s) => s.status)).toEqual(["sugerido", "pendente"]);
    expect(l.insumos_insuficientes).toEqual({
      motivo: "O Estudo só sustenta um ângulo para Stories.",
      sugestao: "Escolha outra análise de criativo.",
      bloqueante: false,
      seguir: false,
    });
    expect(d.agendados).toEqual([]);
  });

  it("Estudo sem avatares: pede a leitura ao agente; sem persona nela, bloqueia — e não há 'seguir assim mesmo'", async () => {
    const semAvatares = { ...ESTUDO, conteudo_md: ESTUDO_MD.split("Avatares Base")[0] };
    // A leitura volta sem nenhuma persona: não há de onde tirar um conceito.
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, [resposta({ avatares: [] })], { estudo: semAvatares, criativos: CRIATIVOS });
    await runConceitos({ id: "k1", deps: d.deps });
    expect(d.perguntas.map((p) => p.split("\n")[0])).toEqual(["## Modo: leitura do Estudo de Copy"]);
    expect(d.linha().insumos_insuficientes).toMatchObject({ bloqueante: true, motivo: expect.stringMatching(/não segue o modelo padrão/) });
    expect(() => seguirAssimMesmo([], d.linha().insumos_insuficientes)).toThrow(AcaoInvalida);
  });

  it("resposta sem JSON é erro da composição, não conceito vazio", async () => {
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, ["só prosa"]);
    await expect(runConceitos({ id: "k1", deps: d.deps })).rejects.toThrow(/não devolveu os conceitos/);
  });
});

describe("gerarConceito — depois de uma rejeição", () => {
  async function etapaPronta() {
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, [resposta(PRIMEIRA)]);
    await runConceitos({ id: "k1", deps: d.deps });
    return d;
  }

  it("rejeitar guarda o conceito com o motivo e pede outro; o novo não repete nada", async () => {
    const d = await etapaPronta();
    const slots = structuredClone(d.linha().conceitos) as Record<string, unknown>[];
    expect(rejeitar(slots as never, 1, { motivo: "não quero falar de boné" })).toEqual({ gerar: [1] });
    await d.deps.gravar({ conceitos: slots });

    // 1ª tentativa repete o anúncio 1; a 2ª é válida, com um ângulo novo.
    const novo = { avatar: "A3", nivel: "consciente_solucao", angulo: "G9", criativo: "C1", justificativa: "c" };
    d.perguntas.length = 0;
    const respostas = [
      resposta({ conceito: { ...PRIMEIRA.conceitos[0] } }),
      resposta({
        angulos_novos: [{ id: "G9", nome: "Penteado de volta", trechos: ["impede de fazer penteados, prender coques"] }],
        conceito: novo,
      }),
    ];
    d.deps.perguntar = async (content: string) => {
      d.perguntas.push(content);
      return respostas.shift()!;
    };
    await gerarConceito({ id: "k1", n: 1, deps: d.deps });

    expect(d.perguntas[0].split("\n")[0]).toBe("## Modo: novo conceito");
    expect(d.perguntas[0]).toMatch(/não quero falar de boné/);
    expect(d.perguntas[1]).toMatch(/Sua sugestão anterior foi recusada\nO worker recusou: repete o conceito do anúncio 1/);
    const slot = (d.linha().conceitos as Record<string, unknown>[])[1];
    expect(slot).toMatchObject({ status: "sugerido", conceito: { avatar_id: "A3", angulo_id: "G3" } });
    expect((slot.rejeitados as unknown[]).length).toBe(1);
  });

  it("sem conceito diferente: o anúncio fica em erro e a composição passa a 'insumos insuficientes'", async () => {
    const d = await etapaPronta();
    const slots = structuredClone(d.linha().conceitos) as Record<string, unknown>[];
    rejeitar(slots as never, 1);
    await d.deps.gravar({ conceitos: slots });
    d.deps.perguntar = async () => resposta({ conceito: null, impossivel: "Só há dois ângulos no Estudo." });
    await gerarConceito({ id: "k1", n: 1, deps: d.deps });
    expect((d.linha().conceitos as Record<string, unknown>[])[1]).toMatchObject({ status: "erro", error: "Só há dois ângulos no Estudo." });
    expect(d.linha().insumos_insuficientes).toMatchObject({ seguir: false, bloqueante: false });
  });

  it("a resposta que chega depois de o anúncio ser resolvido não vale", async () => {
    const d = await etapaPronta();
    const slots = structuredClone(d.linha().conceitos) as Record<string, unknown>[];
    // Ninguém está gerando o anúncio 1: a resposta do agente é descartada.
    d.deps.perguntar = async () => resposta({ conceito: { avatar: "A3", nivel: "consciente_solucao", angulo: "G1", criativo: "C2" } });
    await gerarConceito({ id: "k1", n: 1, deps: d.deps });
    expect(d.linha().conceitos).toEqual(slots);
  });
});

describe("as ações de quem compõe", () => {
  const slot = (over: Record<string, unknown>) => ({ n: 0, formato_saida: "instagram_reels", status: "sugerido", conceito: conceito(), reciclado: false, rejeitados: [], error: null, ...over });

  it("aprovar só o que foi sugerido", () => {
    const slots = [slot({})];
    aprovar(slots as never, 0);
    expect(slots[0].status).toBe("aprovado");
    expect(() => aprovar([slot({ status: "gerando", conceito: null })] as never, 0)).toThrow(AcaoInvalida);
  });

  it("rejeitar um aprovado também vale; rejeitar quem está gerando, não", () => {
    const slots = [slot({ status: "aprovado" })];
    rejeitar(slots as never, 0, { motivo: "outro ângulo" });
    expect(slots[0]).toMatchObject({ status: "gerando", conceito: null });
    expect(slots[0].rejeitados).toHaveLength(1);
    expect(() => rejeitar(slots as never, 0)).toThrow(/já está sugerindo/);
  });

  it("anúncio pendente por insumo insuficiente: primeiro a decisão, depois o pedido", () => {
    const insuficiente = { motivo: "x", sugestao: "", bloqueante: false, seguir: false };
    expect(() => rejeitar([slot({ status: "pendente", conceito: null })] as never, 0, { insuficiente })).toThrow(/Decida antes/);
    const slots = [slot({ status: "pendente", conceito: null }), slot({ n: 1, status: "erro", conceito: null })];
    const r = seguirAssimMesmo(slots as never, insuficiente);
    expect(r.gerar).toEqual([0, 1]);
    expect(r.insumos_insuficientes.seguir).toBe(true);
  });
});

describe("órfãs na etapa de conceitos", () => {
  it("primeira chamada interrompida fecha como erro; anúncio gerando vira erro; quem espera, espera", () => {
    expect(destravarConceitos({ conceitos: [] })).toEqual({ status: "error", error: MOTIVO_REINICIO });
    expect(destravarConceitos({ conceitos: [], insumos_insuficientes: { bloqueante: true } })).toBeNull();
    expect(destravarConceitos({ conceitos: [{ n: 0, status: "sugerido" }] })).toBeNull();
    expect(destravarConceitos({ conceitos: [{ n: 0, status: "gerando" }, { n: 1, status: "aprovado" }] })).toEqual({
      conceitos: [
        { n: 0, status: "erro", error: MOTIVO_CONCEITO_INTERROMPIDO },
        { n: 1, status: "aprovado" },
      ],
    });
  });
});

// ---------------------------------------------------------------------------------------------
// A escrita a partir dos conceitos aprovados (runComposition)
// ---------------------------------------------------------------------------------------------

describe("runComposition com conceitos aprovados", () => {
  beforeEach(() => {
    runAgentCli.mockReset();
    patchComposition.mockReset();
    getCriativo.mockReset();
    conteudoDoDocumento.mockReset();
    listClientDocPages.mockReset();
    getCriativo.mockImplementation(async (id: string) => CRIATIVOS.find((c) => c.id === id) ?? null);
    conteudoDoDocumento.mockImplementation(async (id: string) => (id === "p-estudo" ? { conteudo_md: ESTUDO_MD } : { conteudo_md: "outro" }));
    listClientDocPages.mockResolvedValue([
      { page_id: "p-estudo", nome: "Página 1", doc: { nome: "Estudo de Copy – Dr. Otavio" } },
      { page_id: "p-outro", nome: "Mapeamento", doc: { nome: "Mapeamento do Cliente" } },
    ]);
  });

  const entradas = [
    // O título do navegador NÃO diz que é o Estudo: quem diz é o nome do Doc no banco.
    { tipo: "documento", id: "p-estudo", titulo: "Página 1" },
    { tipo: "documento", id: "p-outro", titulo: "Mapeamento" },
    { tipo: "criativo", id: CRIATIVOS[0].id, titulo: "Sem raspar" },
    { tipo: "criativo", id: CRIATIVOS[1].id, titulo: "Antes de desistir" },
  ];

  it("o material marca o Estudo pelo nome no banco", async () => {
    const { material } = await montarMaterial({ cliente: "otavio", entradas });
    expect(material.documentos.map((d: { estudo: boolean }) => d.estudo)).toEqual([true, false]);
  });

  it("escreve TODOS os anúncios, um por chamada, cada um com o seu conceito e só a análise dele", async () => {
    const catalogo = catalogoComAngulos();
    const slots = [
      { n: 0, formato_saida: "instagram_reels", status: "aprovado", conceito: conceito(), reciclado: false, rejeitados: [] },
      {
        n: 1,
        formato_saida: "meta_ads",
        status: "aprovado",
        conceito: conceito({ avatar: "A2", nivel: "consciente_problema", angulo: "G2", criativo: "C2" }),
        reciclado: false,
        rejeitados: [],
      },
    ];
    runAgentCli
      .mockResolvedValueOnce({ finalText: resposta({ campos: { gancho: "Sem raspar", roteiro: "Fala. Dr. Otavio Lins Brandt | CRM: 00000/MS", texto_na_tela: ["a", "b"], legenda: "l", direcao_visual: "d" } }) })
      .mockResolvedValueOnce({ finalText: resposta({ campos: { primary_text: "p", headline: "h", description: "d", direcao_criativo: "c" } }) });

    await runComposition({ id: "c1", cliente: "otavio", entradas, conceitos: slots, catalogo });

    expect(runAgentCli).toHaveBeenCalledTimes(2);
    const [p1, p2] = runAgentCli.mock.calls.map((c) => (c[0] as { content: string }).content);
    expect(p1).toContain("# O Conceito Estratégico deste anúncio");
    expect(p1).toContain("## Avatar: O Empresário/Líder Discreto");
    // Só a análise de criativo do conceito vai: a do outro anúncio não.
    expect(p1).toContain("## Sem raspar");
    expect(p1).not.toContain("## Antes de desistir");
    expect(p2).toContain("## Antes de desistir");
    expect(p2).toContain("<- ESTE");

    const final = patchComposition.mock.calls.at(-1)?.[1];
    expect(final.status).toBe("revisao");
    expect(final.anuncios.map((a: { status: string }) => a.status)).toEqual(["ok", "ok"]);
    expect(final.anuncios[0].conceito).toMatchObject({ avatar_id: "A1", angulo_id: "G1" });
    expect(final.plano[0].angulo).toBe("Sem raspar a cabeça — O Empresário/Líder Discreto (Homem, 35 a 48 anos)");
  });
});

// ---------------------------------------------------------------------------------------------
// O agente (composeragent.md) e o worker falam a MESMA língua
// ---------------------------------------------------------------------------------------------

import { buildNovoConceitoPrompt, parseNovoConceitoReply } from "../../apps/ad-spy-worker/conceitos.js";

describe("composeragent.md e o worker", () => {
  const md = fs.readFileSync(path.resolve(process.cwd(), "apps/ad-spy-worker/agent/composeragent.md"), "utf-8");
  // O marcador na linha dele: o preâmbulo também o cita, dentro do comando de extração.
  const agentsMd = md.split("\n<!-- AGENTS-MD-START -->\n")[1];
  const catalogo = catalogoComAngulos();
  const slots = [{ n: 0, formato_saida: "instagram_reels", status: "gerando", conceito: null, reciclado: false, rejeitados: [] }];

  it("os cabeçalhos de modo que o worker escreve são os que as instruções reconhecem", () => {
    const conceitos = buildConceitosPrompt({ estudo: ESTUDO, criativos: CRIATIVOS, catalogo }).split("\n")[0];
    const novo = buildNovoConceitoPrompt({ estudo: ESTUDO, criativos: CRIATIVOS, catalogo, slots, n: 0 }).split("\n")[0];
    expect(conceitos).toBe("## Modo: conceitos estratégicos");
    expect(novo).toBe("## Modo: novo conceito");
    expect(agentsMd).toContain("`## Modo: conceitos estratégicos`");
    expect(agentsMd).toContain("`## Modo: novo conceito`");
  });

  it("os contratos JSON das instruções são lidos pelo worker", () => {
    const blocos = [...agentsMd.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    const conceitos = blocos.find((b) => b.includes('"suficiente"'))!;
    const novo = blocos.find((b) => b.includes('"impossivel"'))!;
    const lido = parseConceitosReply("x\n```json\n" + conceitos + "\n```");
    expect(lido.semJson).toBe(false);
    expect(lido.conceitosBrutos[0]).toMatchObject({ anuncio: 1, avatar: "A1", angulo: "G1", criativo: "C1" });
    expect(parseNovoConceitoReply("x\n```json\n" + novo + "\n```").conceitoBruto).toMatchObject({ avatar: "A1" });
  });

  it("as regras de 20/10: preço só do Estudo, e sem RQE nunca 'especialista'", () => {
    expect(agentsMd).not.toMatch(/sem preço ou promoção de\s+procedimento/);
    expect(agentsMd).toMatch(/só entram quando o Estudo de Copy os traz/);
    expect(agentsMd).toMatch(/10\. \*\*Sem RQE, o médico não é "especialista"\.\*\*/);
  });
});

// ---------------------------------------------------------------------------------------------
// Sem ninguém na tela: o "pular revisão" do orquestrador
// ---------------------------------------------------------------------------------------------

import { conduzirSozinho } from "../../apps/ad-spy-worker/composer-conceitos.js";

describe("conduzirSozinho", () => {
  /** A fila "roda" o que foi agendado: cada anúncio agendado ganha um conceito diferente. */
  function comFila(linha: Record<string, unknown>) {
    const d = dubles(linha, []);
    const agendados: number[] = [];
    d.deps.agendar = (n: number) => agendados.push(n);
    const esperar = async () => {
      while (agendados.length) {
        const n = agendados.shift()!;
        const slots = (d.linha().conceitos as Record<string, unknown>[]).map((s) =>
          s.n === n ? { ...s, status: "sugerido", conceito: conceito({ avatar: "A3", criativo: n % 2 ? "C2" : "C1" }), error: null } : s,
        );
        await d.deps.gravar({ conceitos: slots });
      }
    };
    return { d, esperar };
  }
  const base = (over: Record<string, unknown> = {}) => ({
    id: "k1",
    status: "conceitos",
    catalogo_copy: catalogoComAngulos(),
    insumos_insuficientes: null,
    ...over,
  });

  it("aprova tudo o que foi sugerido", async () => {
    const { d, esperar } = comFila(base({ conceitos: [slot0(), { ...slot0(), n: 1, conceito: conceito({ avatar: "A2" }) }] }));
    const slots = await conduzirSozinho({ id: "k1", deps: d.deps, esperar });
    expect(slots.map((s: { status: string }) => s.status)).toEqual(["aprovado", "aprovado"]);
    expect((d.linha().conceitos as { status: string }[]).every((s) => s.status === "aprovado")).toBe(true);
  });

  it("insumos insuficientes: segue reciclando, espera a fila e aprova", async () => {
    const { d, esperar } = comFila(
      base({
        conceitos: [slot0(), { ...slot0(), n: 1, status: "pendente", conceito: null }],
        insumos_insuficientes: { motivo: "x", sugestao: "", bloqueante: false, seguir: false },
      }),
    );
    const slots = await conduzirSozinho({ id: "k1", deps: d.deps, esperar });
    expect(d.linha().insumos_insuficientes).toMatchObject({ seguir: true });
    expect(slots.map((s: { status: string }) => s.status)).toEqual(["aprovado", "aprovado"]);
  });

  it("anúncio sem conceito é pedido de novo; bloqueio não tem saída", async () => {
    const { d, esperar } = comFila(base({ conceitos: [slot0(), { ...slot0(), n: 1, status: "erro", conceito: null }] }));
    await conduzirSozinho({ id: "k1", deps: d.deps, esperar });
    expect((d.linha().conceitos as { status: string }[])[1].status).toBe("aprovado");

    const b = comFila(base({ conceitos: [], insumos_insuficientes: { motivo: "Sem Avatares Base.", sugestao: "", bloqueante: true, seguir: false } }));
    await expect(conduzirSozinho({ id: "k1", deps: b.d.deps, esperar: b.esperar })).rejects.toThrow("Sem Avatares Base.");
  });

  function slot0() {
    return { n: 0, formato_saida: "instagram_reels", status: "sugerido", conceito: conceito(), reciclado: false, rejeitados: [], error: null };
  }
});


// ---------------------------------------------------------------------------------------------
// Estudo fora do modelo padrão: a leitura pelo agente (22/10/2026)
// ---------------------------------------------------------------------------------------------

import { buildLeituraEstudoPrompt, catalogoComLeitura, parseLeituraEstudoReply } from "../../apps/ad-spy-worker/conceitos.js";

// Trechos reais do Estudo do Instituto Serena (subpáginas "Briefing" e "Buyer Personas").
const ESTUDO_DIVIDIDO_MD = [
  "## Subpágina: 1. Briefing de Copy – Instituto Serena",
  "",
  "**O Dr. Paulo Galvão do @dr.paulogusmao é um médico nutrólogo carioca** (RQE 20504) com formação também em anestesiologia.",
  "",
  "## Subpágina: 2. Buyer Personas - Instituto Serena",
  "",
  "# PERSONA 1: Consciente do Problema (CP) - O Choque de Realidade",
  'Status: "Meu corpo parou de me obedecer. A dieta não funciona, estou exausta e me sinto invisível."',
  '*   A Dor Raiz (O "Porquê"): O medo visceral de se tornar irrelevante, invisível ou substituível (Sombra).',
  "# PERSONA 2: Consciente da Solução (CS) - A Busca Pelo Milagre",
  "*   Barreiras Comportamentais: Paralisia por análise (Sobrecarga). Ginecologista fala uma coisa, nutricionista fala outra.",
].join("\n");
const ESTUDO_DIVIDIDO = { page_id: "pDela", nome: "Estudo de Copy - Instituto Serena", conteudo_md: ESTUDO_DIVIDIDO_MD, estudo: true };

const LEITURA = {
  identificacao: { nome: "Dr. Paulo Galvão", crm: "52.12345-6", rqe: "20504" },
  avatares: [
    {
      nome: "Persona 1 - O Choque de Realidade",
      nivel: "consciente_problema",
      nivel_original: "Consciente do Problema (CP)",
      perfil: "Executiva de 46 anos que não reconhece o próprio corpo.",
      dor: "Medo de se tornar invisível.",
      trechos: ["O medo visceral de se tornar irrelevante, invisível ou substituível"],
    },
    {
      nome: "Persona 2 - A Busca Pelo Milagre",
      nivel: "consciente_solucao",
      nivel_original: "",
      perfil: "Já pesquisa canetas e reposição.",
      dor: "Fragmentação do cuidado.",
      trechos: ["Paralisia por análise (Sobrecarga). Ginecologista fala uma coisa"],
    },
    { nome: "Persona inventada", nivel: "inconsciente", trechos: ["ela sonha com uma ilha deserta e paradisíaca"] },
  ],
};

describe("leitura do Estudo pelo agente", () => {
  it("o pedido abre com o modo, e diz que o Estudo não segue o modelo", () => {
    const p = buildLeituraEstudoPrompt({ ficha: { nome: "Instituto Serena" }, estudo: ESTUDO_DIVIDIDO });
    expect(p.split("\n")[0]).toBe("## Modo: leitura do Estudo de Copy");
    expect(p).toContain("PERSONA 1: Consciente do Problema");
  });

  it("confere tudo contra o texto: trecho, nível e identificação", () => {
    const base = catalogoInicial({ estudo: ESTUDO_DIVIDIDO, criativos: CRIATIVOS });
    expect(base.avatares).toEqual([]);
    const { catalogo, descartados } = catalogoComLeitura(base, LEITURA, ESTUDO_DIVIDIDO_MD);
    // A persona sem trecho que exista no Estudo sai.
    expect(descartados).toBe(1);
    expect(catalogo.avatares.map((a: { id: string; nome: string; nivel: string; nivel_inferido: boolean }) => [a.id, a.nome, a.nivel, a.nivel_inferido])).toEqual([
      ["A1", "Persona 1 - O Choque de Realidade", "consciente_problema", false],
      // Sem as palavras do Estudo sobre o nível, é o que o agente escolheu — marcado como inferido.
      ["A2", "Persona 2 - A Busca Pelo Milagre", "consciente_solucao", true],
    ]);
    expect(catalogo).toMatchObject({ avatares_origem: "agente", faltando: [], tem_rqe: true });
    // O CRM que o agente trouxe não está no texto: não vai para a assinatura.
    expect(catalogo.assinatura).toBe("Dr. Paulo Galvão | CRM: [CRM] | RQE: 20504");
  });

  it("na etapa: o código não acha avatar, o agente lê o Estudo, e os conceitos usam os avatares dele", async () => {
    const conceitos = {
      anuncios: [{ formato: "instagram_reels" }],
      angulos: [{ id: "G1", nome: "Invisível depois dos 40", trechos: ["O medo visceral de se tornar irrelevante"] }],
      conceitos: [{ anuncio: 1, avatar: "A1", nivel: "consciente_problema", angulo: "G1", criativo: "C2" }],
      suficiente: true,
    };
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, [resposta(LEITURA), resposta(conceitos)], {
      estudo: ESTUDO_DIVIDIDO,
      criativos: CRIATIVOS,
    });
    await runConceitos({ id: "k1", deps: d.deps });
    expect(d.perguntas.map((p) => p.split("\n")[0])).toEqual(["## Modo: leitura do Estudo de Copy", "## Modo: conceitos estratégicos"]);
    expect(d.perguntas[1]).toContain("## A1 — Persona 1 - O Choque de Realidade");
    expect((d.linha().conceitos as { status: string }[]).map((s) => s.status)).toEqual(["sugerido"]);
    expect((d.linha().catalogo_copy as { avatares_origem: string }).avatares_origem).toBe("agente");
  });

  it("a leitura não acha persona verificável: para, dizendo que o Estudo está fora do modelo", async () => {
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, [resposta({ avatares: [LEITURA.avatares[2]] })], {
      estudo: ESTUDO_DIVIDIDO,
      criativos: CRIATIVOS,
    });
    await runConceitos({ id: "k1", deps: d.deps });
    expect(d.perguntas).toHaveLength(1);
    expect(d.linha().insumos_insuficientes).toMatchObject({
      bloqueante: true,
      motivo: expect.stringMatching(/não segue o modelo padrão e a leitura pelo agente não achou os avatares/),
    });
  });

  it("sem análise de criativo pronta, nem pede a leitura — e diz que o que falta é o criativo", async () => {
    const d = dubles({ id: "k1", status: "conceitos", conceitos: [] }, [], { estudo: ESTUDO_DIVIDIDO, criativos: [] });
    await runConceitos({ id: "k1", deps: d.deps });
    expect(d.perguntas).toEqual([]);
    expect(d.linha().insumos_insuficientes).toMatchObject({ motivo: expect.stringMatching(/análises de criativo/) });
  });

  it("as instruções do agente têm o modo e o contrato que o worker lê", () => {
    const md = fs.readFileSync(path.resolve(process.cwd(), "apps/ad-spy-worker/agent/composeragent.md"), "utf-8");
    const agentsMd = md.split("\n<!-- AGENTS-MD-START -->\n")[1];
    expect(agentsMd).toContain("`## Modo: leitura do Estudo de Copy`");
    const bloco = [...agentsMd.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]).find((b) => b.includes('"nivel_original"'))!;
    expect(parseLeituraEstudoReply("x\n```json\n" + bloco + "\n```").avatares).toHaveLength(1);
  });
});
