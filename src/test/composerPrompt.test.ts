/**
 * Prompt e leitura da resposta do agente do Ad Composer.
 *
 * O módulo testado é do worker (`apps/ad-spy-worker/composer-prompt.js`) e é puro de propósito —
 * sem I/O, sem config, sem o cliente do Gateway —, então roda aqui sem servidor nenhum.
 */
import { describe, it, expect } from "vitest";
import {
  blocoDocumentos,
  blocoRelatorios,
  buildAnuncioPrompt,
  buildComposerPrompt,
  descreverCatalogo,
  descreverFormato,
  esqueletoJson,
  parseComposerReply,
  parsePlano,
  resumirAnuncios,
} from "../../apps/ad-spy-worker/composer-prompt.js";
import { getFormato } from "../../shared/ad-formats.js";

const FICHA = {
  nome: "Dr. José Ramos - VascuMed",
  especialidades: ["Cirurgia Vascular"],
  plano: "Escala",
  squad: "Marina",
};

const SEMANA = { de: "2026-09-07", ate: "2026-09-13" };
const METRICAS = {
  investimento: 3000,
  leadsCRM: 48,
  leadsTrafego: 62,
  consultasAgendadas: 11,
  faturamentoBruto: 24000,
  roas: 8,
};

const ANALISE = {
  titulo: "Varizes — ângulos que sustentam",
  tema: "tratamento de varizes",
  especialidades: ["Cirurgia Vascular"],
  analysis_md: "## Ângulos\nOs anúncios longevos abrem nomeando o medo da cirurgia.",
  ads: [
    {
      page_name: "Clínica Vaso Livre",
      days_running: 120,
      ad_copy: "Chega de esconder as pernas.",
      transcript: "Muita gente adia o tratamento por medo da cirurgia.",
    },
  ],
};

const BRIEF = { brief_md: "## Contexto\nCliente de Cirurgia Vascular, 18 meses de casa." };

describe("buildComposerPrompt", () => {
  it("leva a ficha, o resumo e a análise, com o catálogo de formatos", () => {
    const p = buildComposerPrompt({
      ficha: FICHA,
      analise: ANALISE,
      brief: BRIEF,
    });
    expect(p).toContain("Dr. José Ramos - VascuMed");
    expect(p).toContain("Cirurgia Vascular");
    // Resumo do cliente
    expect(p).toContain("18 meses de casa");
    // Análise da Biblioteca, com os anúncios que a embasaram
    expect(p).toContain("Varizes — ângulos que sustentam");
    expect(p).toContain("medo da cirurgia");
    expect(p).toContain("Clínica Vaso Livre");
    // Spec do formato
    expect(p).toContain("Google Ads (busca)");
    expect(p).toContain("`headlines`");
  });

  it("diz ao agente quando NÃO tem análise nem resumo", () => {
    const p = buildComposerPrompt({ ficha: FICHA });
    expect(p).toContain("SEM análise de concorrentes");
    expect(p).toContain("não há resumo salvo");
  });

  it("não fala mais de métricas da semana fechada — o número vem do Relatório", () => {
    // O insumo saiu em 02/10/2026. Este teste é o que impede alguém de reintroduzir o bloco sem
    // decisão: havia DOIS caminhos de número por composição, e o que ficou é o que a pessoa escolhe.
    const p = buildComposerPrompt({
      ficha: FICHA,
      analise: ANALISE,
      brief: BRIEF,
      // Passar as chaves antigas não pode ressuscitar o bloco: uma aba velha manda isto.
      semana: SEMANA,
      metricas: METRICAS,
    } as Parameters<typeof buildComposerPrompt>[0]);
    expect(p).not.toContain("semana fechada");
    expect(p).not.toContain("3.000,00");
    expect(p).not.toContain("não foi possível ler as métricas");
  });

  it("marca a instrução de quem pediu como subordinada aos limites", () => {
    const p = buildComposerPrompt({
      ficha: FICHA,
      extraPrompt: "foque em quem tem medo de anestesia",
    });
    expect(p).toContain("foque em quem tem medo de anestesia");
    expect(p).toContain("NÃO manda sobre os limites de caractere");
  });

  it("encolhe a análise para caber no teto, em vez de estourar o turno", () => {
    const gigante = { ...ANALISE, analysis_md: "palavra ".repeat(50000) };
    const p = buildComposerPrompt({
      ficha: FICHA,
      analise: gigante,
      maxChars: 12000,
    });
    expect(p.length).toBeLessThan(12000);
    // E diz que cortou: meia frase tratada como frase inteira é pior que frase ausente.
    expect(p).toContain("(cortado)");
  });

  it("não recebe formato: manda o catálogo e deixa a escolha com o agente", () => {
    // O formato era campo obrigatório da tela — a pessoa decidia "vai ser um Reels" antes de saber
    // se o material dava um Reels. Agora quem escolhe é quem leu o conteúdo.
    const p = buildComposerPrompt({ ficha: FICHA });
    expect(p).toContain("# Catálogo de formatos");
    expect(p).toContain("google_ads");
    expect(p).toContain("instagram_reels");
    expect(p).toMatch(/Decida o CONJUNTO/);
    expect(p).toMatch(/nomear os usos .*, obedeça/);
  });

  it("leva relatórios e documentos quando eles são escolhidos", () => {
    const p = buildComposerPrompt({
      ficha: FICHA,
      relatorios: [{ periodo_label: "Setembro", relatorio_md: "## Leitura\nO CPL caiu." }],
      documentos: [{ nome: "Estratégia 2026", local: "Clientes › X", conteudo_md: "Posicionamento premium." }],
    });
    expect(p).toContain("# Relatórios deste cliente");
    expect(p).toContain("Setembro");
    expect(p).toContain("O CPL caiu.");
    expect(p).toContain("# Documentos do cliente (ClickUp)");
    expect(p).toContain("Estratégia 2026");
    expect(p).toContain("Posicionamento premium.");
  });

  it("documento sem corpo é dito como tal, para o agente não inventar o conteúdo", () => {
    const p = buildComposerPrompt({
      ficha: FICHA,
      documentos: [{ nome: "Briefing antigo", local: "Clientes › X", conteudo_md: null }],
    });
    expect(p).toContain("Briefing antigo");
    expect(p).toMatch(/não foi possível ler o conteúdo deste documento/i);
    expect(p).toMatch(/NÃO\s+suponha o que há dentro/i);
  });
});

describe("descreverCatalogo", () => {
  it("lista todos os formatos disponíveis e nenhum indisponível", () => {
    const c = descreverCatalogo();
    for (const id of ["instagram_reels", "instagram_stories", "instagram_feed", "meta_ads", "google_ads"]) {
      expect(c, id).toContain(id);
    }
    // TikTok é `disponivel: false`: a tela não o oferece, o agente não pode escolhê-lo.
    expect(c).not.toContain("tiktok");
  });
});

describe("blocoRelatorios e blocoDocumentos", () => {
  it("sem insumo, não ocupam espaço no prompt", () => {
    expect(blocoRelatorios([], 5000)).toBe("");
    expect(blocoDocumentos([], 5000)).toBe("");
  });

  it("relatório sem conteúdo é ignorado em vez de entrar vazio", () => {
    expect(blocoRelatorios([{ periodo_label: "Set", relatorio_md: null }], 5000)).toBe("");
  });

  it("cortam o que não cabe e dizem que cortaram", () => {
    const txt = blocoRelatorios(
      [{ periodo_label: "Set", relatorio_md: "x".repeat(50000) }],
      3000,
    );
    expect(txt).toContain("(cortado)");
    expect(txt.length).toBeLessThan(10000);
  });
});

describe("descreverFormato", () => {
  it("distingue limite RÍGIDO de recomendação", () => {
    const google = descreverFormato(getFormato("google_ads"));
    expect(google).toMatch(/até 30 caracteres CADA ITEM — a plataforma RECUSA/);

    const meta = descreverFormato(getFormato("meta_ads"));
    // 125 do texto principal é recomendação: corta na exibição, não é recusa.
    expect(meta).toMatch(/até 125 caracteres \(recomendado/);
    expect(meta).not.toMatch(/até 125 caracteres — a plataforma RECUSA/);
  });

  it("declara quantos itens cada lista pede", () => {
    expect(descreverFormato(getFormato("google_ads"))).toContain("lista de 3 a 15 itens");
  });
});

describe("esqueletoJson", () => {
  it("exige o formato declarado e os campos aninhados", () => {
    // As chaves de `campos` mudam por formato, então o esqueleto mostra a FORMA e manda consultar
    // o catálogo. O que ele não pode deixar de exigir é `formato`: sem a declaração não há como
    // validar limite nenhum.
    const esqueleto = esqueletoJson();
    expect(esqueleto).toContain('"formato"');
    expect(esqueleto).toContain('"formato_justificativa"');
    expect(esqueleto).toContain('"campos"');
  });
});

describe("resumirAnuncios", () => {
  it("respeita o orçamento e avisa o que cortou", () => {
    const ads = Array.from({ length: 10 }, (_, i) => ({
      page_name: `Anunciante ${i}`,
      ad_copy: "x".repeat(5000),
      transcript: "y".repeat(5000),
    }));
    const texto = resumirAnuncios(ads, 4000);
    expect(texto.length).toBeLessThan(8000);
    expect(texto).toContain("(cortado)");
    expect(texto).toContain("Anunciante 0");
  });

  it("numera na mesma ordem em que a análise cita #1, #2…", () => {
    const texto = resumirAnuncios(
      [{ page_name: "Primeiro" }, { page_name: "Segundo" }],
      2000
    );
    expect(texto.indexOf("#1 — Primeiro")).toBeLessThan(texto.indexOf("#2 — Segundo"));
  });
});

describe("parseComposerReply", () => {
  const resposta = [
    "A ideia é abrir pelo medo da cirurgia, que é a objeção do nicho.",
    "",
    "```json",
    JSON.stringify({
      formato: "google_ads",
      formato_justificativa: "O material é todo de intenção de busca.",
      campos: {
        headlines: ["Varizes sem cirurgia", "Tratamento em 40 minutos", "Cirurgião vascular"],
        descriptions: ["Avaliação com cirurgião vascular.", "Agende sua consulta hoje."],
      },
    }),
    "```",
  ].join("\n");

  it("separa a prosa do bloco e usa o formato que o AGENTE declarou", () => {
    const r = parseComposerReply(resposta);
    expect(r.composicaoMd).toContain("medo da cirurgia");
    expect(r.composicaoMd).not.toContain("```json");
    expect(r.formato).toBe("google_ads");
    expect(r.justificativa).toContain("intenção de busca");
    expect(r.composicao?.headlines).toHaveLength(3);
    expect(r.avisos).toEqual([]);
  });

  it("formato ausente ou desconhecido degrada para prosa, com aviso — não lança", () => {
    const semFormato = parseComposerReply('Ideia.\n\n```json\n{"campos":{}}\n```');
    expect(semFormato.composicao).toBeNull();
    expect(semFormato.composicaoMd).toContain("Ideia.");
    expect(semFormato.avisos[0]).toMatchObject({ campo: "formato", tipo: "formato_desconhecido" });

    const inventado = parseComposerReply('Ideia.\n\n```json\n{"formato":"orkut","campos":{}}\n```');
    expect(inventado.avisos[0].detalhe).toContain("orkut");
  });

  it("aceita os campos na raiz: é onde o agente AINDA não reaplicado os põe", () => {
    // Durante o deploy o agente no servidor pode estar na versão antiga do contrato. Sem este
    // fallback, a primeira composição depois do restart voltaria vazia sem explicar por quê.
    const r = parseComposerReply(
      `Ideia.\n\n\`\`\`json\n${JSON.stringify({
        formato: "meta_ads",
        headline: "Título na raiz",
      })}\n\`\`\``,
    );
    expect(r.composicao?.headline).toBe("Título na raiz");
  });

  it("JSON ruim degrada para prosa-só, sem perder a ideia", () => {
    const r = parseComposerReply("A ideia é essa.\n\n```json\n{ nao é json }\n```");
    expect(r.composicao).toBeNull();
    expect(r.composicaoMd).toContain("A ideia é essa.");
  });

  it("um headline de 34 caracteres vira aviso, não silêncio", () => {
    const longo = "Tratamento de varizes sem cirurgia"; // 34
    expect(longo.length).toBe(34);
    const r = parseComposerReply(
      `Ideia.\n\n\`\`\`json\n${JSON.stringify({
        formato: "google_ads",
        campos: { headlines: [longo, "Ok", "Ok"], descriptions: ["a", "b"] },
      })}\n\`\`\``,
    );
    expect(r.avisos).toContainEqual({
      campo: "headlines",
      indice: 0,
      tipo: "excede_limite_rigido",
      detalhe: "34/30 caracteres",
    });
  });

  it("descarta campo que o formato não pede e garante os que pede", () => {
    const r = parseComposerReply(
      `Ideia.\n\n\`\`\`json\n${JSON.stringify({
        formato: "meta_ads",
        campos: { headline: "Título", inventado: "nada a ver" },
      })}\n\`\`\``,
    );
    expect(r.composicao).not.toHaveProperty("inventado");
    expect(Object.keys(r.composicao!)).toEqual(
      getFormato("meta_ads")!.campos.map((c) => c.id)
    );
    // Campo que o agente não mandou existe vazio: a tela desenha a spec inteira de qualquer jeito.
    expect(r.composicao!.primary_text).toBe("");
  });

  it("achata item de lista que veio como objeto, em vez de '[object Object]'", () => {
    const r = parseComposerReply(
      `Ideia.\n\n\`\`\`json\n${JSON.stringify({
        formato: "instagram_stories",
        campos: { sequencia: [{ imagem: "Close no rosto", fala: "Você adia por medo?" }] },
      })}\n\`\`\``,
    );
    expect(r.composicao!.sequencia[0]).toBe("Close no rosto — Você adia por medo?");
  });
});

describe("conjunto de anúncios", () => {
  const bloco = (obj: unknown) => ["A ideia do conjunto.", "", "```json", JSON.stringify(obj), "```"].join("\n");

  it("a primeira chamada pede o conjunto, de 1 a 8, e só o primeiro anúncio", () => {
    const prompt = buildComposerPrompt({ ficha: FICHA, extraPrompt: "um Reels e dois Stories" });
    expect(prompt).toContain("de 1 a 8");
    expect(prompt).toContain("SÓ O PRIMEIRO");
    expect(prompt).toContain('"anuncios"');
    // Sem pedido de quantidade o default é um: é o que mantém o comportamento de sempre.
    expect(prompt).toContain("Sem pedido de quantidade, é UM");
  });

  it("lê o plano na ordem e guarda o ângulo de cada anúncio", () => {
    const { plano, descartados, cortados } = parsePlano(
      bloco({
        anuncios: [
          { formato: "instagram_reels", angulo: "O medo da cirurgia.", formato_justificativa: "Tem quem grave." },
          { formato: "google_ads", angulo: "Quem já pesquisa." },
        ],
        campos: { gancho: "x" },
      }),
    );
    expect(plano.map((p: { formato: string }) => p.formato)).toEqual(["instagram_reels", "google_ads"]);
    expect(plano[0].angulo).toBe("O medo da cirurgia.");
    expect(plano[1].justificativa).toBeNull();
    expect(descartados).toBe(0);
    expect(cortados).toBe(0);
  });

  it("corta no teto de 8 e descarta formato fora do catálogo, contando os dois", () => {
    const anuncios = [
      { formato: "outdoor" },
      // Registrado mas indisponível: não tem campos, então não há o que escrever.
      { formato: "tiktok" },
      ...Array.from({ length: 10 }, () => ({ formato: "meta_ads" })),
    ];
    const { plano, descartados, cortados } = parsePlano(bloco({ anuncios }));
    expect(plano).toHaveLength(8);
    expect(descartados).toBe(2);
    expect(cortados).toBe(2);
  });

  it("resposta no contrato ANTERIOR não tem plano — quem chama cai para um anúncio só", () => {
    const antiga = bloco({ formato: "google_ads", campos: { headlines: ["a", "b", "c"] } });
    expect(parsePlano(antiga).plano).toEqual([]);
    // E o parser de sempre continua lendo essa resposta inteira.
    expect(parseComposerReply(antiga).formato).toBe("google_ads");
    expect(parsePlano("só prosa, sem bloco").plano).toEqual([]);
  });

  it("o formato do plano manda sobre o que a resposta declara", () => {
    const r = parseComposerReply(
      bloco({ formato: "instagram_reels", campos: { headlines: ["a", "b", "c"], descriptions: ["x", "y"] } }),
      { formatoFixo: "google_ads" },
    );
    expect(r.formato).toBe("google_ads");
    expect(r.composicao?.headlines).toHaveLength(3);
  });

  it("sem bloco, o anúncio mantém o formato do plano e fica só com a prosa", () => {
    const r = parseComposerReply("Só a prosa.", { formatoFixo: "google_ads" });
    expect(r.formato).toBe("google_ads");
    expect(r.composicao).toBeNull();
    expect(r.composicaoMd).toContain("Só a prosa");
  });

  it("as chamadas seguintes levam SÓ a spec do formato daquele anúncio", () => {
    const plano = [
      { formato: "instagram_reels", angulo: "O medo da cirurgia." },
      { formato: "google_ads", angulo: "Quem já pesquisa." },
    ];
    const prompt = buildAnuncioPrompt({ ficha: FICHA, analise: ANALISE, brief: BRIEF, plano, indice: 1 });
    expect(prompt).toContain("SÓ o anúncio 2 de 2: Google Ads (busca)");
    expect(prompt).toContain("`headlines`");
    // Os campos do Reels não entram: o agente não está mais escolhendo formato.
    expect(prompt).not.toContain("`gancho`");
    // Mas o ângulo dele entra, na lista do conjunto: é o que evita dois anúncios iguais.
    expect(prompt).toContain("1. Instagram Reels — O medo da cirurgia.");
    expect(prompt).toContain("Quem já pesquisa.  <- ESTE");
    // O material do cliente é o mesmo da primeira chamada.
    expect(prompt).toContain("medo da cirurgia");
    expect(prompt).toContain("18 meses de casa");
  });
});
