/**
 * O agente que destrincha um anúncio pronto em arte (`apps/ad-spy-worker/arte-prompt.js`): o prompt,
 * a leitura da resposta e a montagem do post com as regras de identificação.
 *
 * Puro de propósito — sem I/O, sem config, sem o cliente do Gateway —, então roda sem servidor.
 */
import { describe, it, expect } from "vitest";
import {
  anunciosDaLinha,
  aplicarRegrasDoPost,
  buildArtePrompt,
  hashDoAnuncio,
  legendaDoAnuncio,
  montarPost,
  normalizarOpcoes,
  parseArteReply,
  totalDeSlides,
} from "../../apps/ad-spy-worker/arte-prompt.js";
import { kitVazio } from "../../shared/brand-kit.js";
import { getTemplate, normalizarSlides, validarSlides } from "../../shared/post-templates.js";

const template = getTemplate("editorial")!;

const feed = (carrossel: string[] = []) => ({
  formato: "instagram_feed",
  angulo: "O ronco como sinal",
  status: "ok",
  composicao: {
    abertura: "Ronco não é só barulho.",
    legenda: "Ronco não é só barulho. Entenda o que pode estar por trás.",
    carrossel,
    direcao_foto: "Médico no consultório, luz natural.",
  },
});

const ID = { nome: "Dr. Fulano", crm: "12345", uf: "RS", rqe: "678", pos_graduacao: "" };

const resposta = (json: object) => `Dividi o anúncio em páginas.\n\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;

describe("anúncio de origem", () => {
  it("lê a composição antiga, de um anúncio só nas colunas", () => {
    const lista = anunciosDaLinha({ anuncios: [], formato: "meta_ads", composicao: { primary_text: "x" } });
    expect(lista).toHaveLength(1);
    expect(lista[0].formato).toBe("meta_ads");
  });

  it("uma página por card do carrossel; lista vazia é post único; teto de 10", () => {
    expect(totalDeSlides(feed())).toBe(1);
    expect(totalDeSlides(feed(["a", "b", "c"]))).toBe(3);
    expect(totalDeSlides(feed(Array.from({ length: 14 }, (_, i) => `c${i}`)))).toBe(10);
    expect(totalDeSlides({ formato: "meta_ads", composicao: {} })).toBe(1);
  });

  it("a legenda do feed é o campo legenda; a do pago, o texto principal", () => {
    expect(legendaDoAnuncio(feed())).toMatch(/^Ronco/);
    expect(legendaDoAnuncio({ formato: "meta_ads", composicao: { primary_text: "Texto pago" } })).toBe("Texto pago");
  });

  it("o hash muda quando a copy muda", () => {
    const a = feed();
    const b = { ...feed(), composicao: { ...feed().composicao, abertura: "Outra" } };
    expect(hashDoAnuncio(a)).toBe(hashDoAnuncio(feed()));
    expect(hashDoAnuncio(a)).not.toBe(hashDoAnuncio(b));
  });
});

describe("buildArtePrompt", () => {
  const prompt = buildArtePrompt({
    anuncio: feed(["Capa: 'Seu ronco tem nome' — foto do médico", "O que é apneia", "Agende"]),
    template,
    cliente: "Dr. Fulano",
    uso: "organico",
    circulaFora: false,
    elementos: { logo: true, whatsapp: true },
    fotos: [{ tipo: "medico", descricao: "foto do médico (Brand kit)" }],
    identificacao: ID,
    naLegenda: false,
  });

  it("abre com o cabeçalho de modo e fixa o número de páginas", () => {
    expect(prompt.split("\n")[0]).toBe("## Modo: destrinchar anúncio em arte");
    expect(prompt).toMatch(/EXATAMENTE 3/);
    expect(prompt).toMatch(/1: capa; 2: conteudo; 3: conteudo ou cta/);
  });

  it("leva a identificação para o agente copiar, mesmo sem ir na arte", () => {
    expect(prompt).toMatch(/- crm: 12345/);
    expect(prompt).toMatch(/- rqe: 678/);
  });

  it("leva os cards, as fotos e os limites dos slots", () => {
    expect(prompt).toMatch(/Seu ronco tem nome/);
    expect(prompt).toMatch(/foto 0: Foto do médico/);
    expect(prompt).toMatch(/até 70 caracteres/);
  });
});

describe("parseArteReply", () => {
  it("sem bloco json, avisa", () => {
    expect(parseArteReply("só prosa", { template, total: 1 }).semJson).toBe(true);
  });

  it("corta páginas a mais, completa as que faltam e corrige o papel pela posição", () => {
    const lido = parseArteReply(
      resposta({ slides: [{ papel: "unico", titulo: "A" }, { papel: "capa", titulo: "B" }, { titulo: "C" }, { titulo: "D" }] }),
      { template, total: 3 }
    );
    expect(lido.slides.map((s) => s.papel)).toEqual(["capa", "conteudo", "conteudo"]);
    expect(lido.slides.map((s) => s.titulo)).toEqual(["A", "B", "C"]);
    const curto = parseArteReply(resposta({ slides: [{ titulo: "A" }] }), { template, total: 2 });
    expect(curto.slides).toHaveLength(2);
    expect(curto.slides[1].titulo).toBe("");
  });

  it("foto só com índice válido e em layout que aceita foto", () => {
    const lido = parseArteReply(
      resposta({ slides: [{ titulo: "A", foto: 0 }, { titulo: "B", foto: 5 }, { papel: "cta", titulo: "C", cta: "x", foto: 0 }] }),
      { template, total: 3, fotos: 1 }
    );
    expect(lido.slides.map((s) => s.foto)).toEqual([0, null, null]);
  });

  it("limpa hashtags", () => {
    const lido = parseArteReply(resposta({ slides: [{ titulo: "A" }], hashtags: ["#sono", "medicina do sono", "apneia"] }), {
      template,
      total: 1,
    });
    expect(lido.hashtags).toEqual(["sono", "medicinadosono", "apneia"]);
  });
});

describe("montarPost", () => {
  const lido = (extra: object = {}) =>
    parseArteReply(
      resposta({
        slides: [{ papel: "unico", titulo: "Ronco não é só barulho", alt: "x" }],
        legenda: "Legenda do agente.",
        identificacao: { nome: "Dr. Fulano", crm: "12345", uf: "RS", rqe: "678" },
        ...extra,
      }),
      { template, total: 1 }
    );
  const opcoes = { uso: "organico", circula_fora: false, elementos: { logo: true } };

  it("usa a identificação do kit e monta a linha", () => {
    const { post, avisos } = montarPost({
      lido: lido(),
      anuncio: feed(),
      template,
      opcoes,
      kitIdentificacao: ID,
      onde: { naArte: true, naLegenda: false },
    });
    expect(post.identificacao.linha).toBe("Dr. Fulano | CRM/RS 12345 | RQE 678");
    expect(post.identificacao.naArte).toBe(true);
    expect(post.elementos.identificacao).toBe(true);
    expect(avisos.filter((a) => a.campo === "identificacao")).toEqual([]);
  });

  it("CRM diferente do kit vira aviso, e fica o do kit", () => {
    const { post, avisos } = montarPost({
      lido: lido({ identificacao: { nome: "Dr. Fulano", crm: "99999", uf: "RS", rqe: "678" } }),
      anuncio: feed(),
      template,
      opcoes,
      kitIdentificacao: ID,
      onde: { naArte: true, naLegenda: false },
    });
    expect(post.identificacao.crm).toBe("12345");
    expect(avisos.map((a) => a.tipo)).toContain("identificacao_divergente");
  });

  it("sem legenda do agente, fica a do anúncio", () => {
    const { post, avisos } = montarPost({
      lido: lido({ legenda: "" }),
      anuncio: feed(),
      template,
      opcoes,
      kitIdentificacao: ID,
      onde: { naArte: false, naLegenda: false },
    });
    expect(post.legenda).toBe(feed().composicao.legenda);
    expect(avisos.map((a) => a.tipo)).toContain("legenda_do_anuncio");
  });

  it("identificação na legenda: acrescenta a linha uma vez só, mesmo ajustando de novo", () => {
    const { post } = montarPost({
      lido: lido(),
      anuncio: feed(),
      template,
      opcoes: { ...opcoes, uso: "pago" },
      kitIdentificacao: ID,
      onde: { naArte: false, naLegenda: true },
    });
    expect(post.legenda).toBe("Legenda do agente.\n\nDr. Fulano | CRM/RS 12345 | RQE 678");
    const de_novo = aplicarRegrasDoPost(post, template, ID).post;
    expect(de_novo.legenda).toBe(post.legenda);
  });

  it('sem RQE e citando a pós na arte: "NÃO ESPECIALISTA" na arte, mesmo onde era opcional', () => {
    const semRqe = { ...ID, rqe: "", pos_graduacao: "Medicina do Sono" };
    const { post, avisos } = montarPost({
      lido: parseArteReply(
        resposta({ slides: [{ papel: "unico", titulo: "Pós-graduado em Medicina do Sono", alt: "x" }], legenda: "L" }),
        { template, total: 1 }
      ),
      anuncio: feed(),
      template,
      opcoes,
      kitIdentificacao: semRqe,
      onde: { naArte: false, naLegenda: false },
    });
    expect(post.identificacao.naArte).toBe(true);
    expect(post.identificacao.linha).toBe("Dr. Fulano | CRM/RS 12345 | NÃO ESPECIALISTA");
    expect(post.elementos.identificacao).toBe(true);
    expect(avisos.map((a) => a.tipo)).toContain("nao_especialista");
  });
});

describe("normalizarOpcoes", () => {
  const kit = {
    ...kitVazio("dr_fulano"),
    nome_clinica: "Clínica",
    contatos: { whatsapp: "(51) 9", telefone: "", instagram: "", site: "", email: "" },
    imagens: { logo: "brand-kits/dr_fulano/logo-1.png", logo_escuro: null, foto_medico: "brand-kits/dr_fulano/foto_medico-1.jpg" },
  };

  it("uso padrão pelo formato", () => {
    expect(normalizarOpcoes({}, { kit, cliente: "dr_fulano", formato: "meta_ads" }).opcoes.uso).toBe("pago");
    expect(normalizarOpcoes({}, { kit, cliente: "dr_fulano", formato: "instagram_feed" }).opcoes.uso).toBe("organico");
  });

  it("elemento que o kit não tem não liga", () => {
    const { opcoes } = normalizarOpcoes(
      { elementos: { logo: true, whatsapp: true, instagram: true, endereco: true } },
      { kit, cliente: "dr_fulano", formato: "instagram_feed" }
    );
    expect(opcoes.elementos).toMatchObject({ logo: true, whatsapp: true, instagram: false, endereco: false });
  });

  it("foto de outro cliente é recusada; a do médico entra primeiro", () => {
    const { opcoes, erros } = normalizarOpcoes(
      {
        elementos: { foto_medico: true },
        fotos: [
          { caminho: "artes/dr_fulano/fotos/a.jpg", tipo: "estrutura", descricao: "recepção" },
          { caminho: "artes/outro/fotos/b.jpg", tipo: "equipe" },
          { caminho: "artes/dr_fulano/fotos/../../outro/c.jpg", tipo: "equipe" },
        ],
      },
      { kit, cliente: "dr_fulano", formato: "instagram_feed" }
    );
    expect(erros).toHaveLength(1);
    expect(opcoes.fotos.map((f) => f.tipo)).toEqual(["medico", "estrutura"]);
    expect(opcoes.fotos[0].caminho).toBe(kit.imagens.foto_medico);
  });
});

describe("validarSlides", () => {
  it("acusa título vazio, limite estourado e alt ausente", () => {
    const slides = normalizarSlides([{ papel: "capa", titulo: "x".repeat(71) }, { titulo: "" }], template);
    const tipos = validarSlides(slides, template).map((a) => `${a.slide}:${a.tipo}`);
    expect(tipos).toContain("0:excede_limite");
    expect(tipos).toContain("1:vazio");
    expect(tipos).toContain("0:sem_alt");
  });
});
