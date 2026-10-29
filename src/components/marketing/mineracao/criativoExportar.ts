import { NIVEL_CONSCIENCIA_LABEL, type SpyCriativo, type SpyDissecacaoCriativo } from "@/lib/adSpyApi";
import { markdownParaTexto } from "@/utils/relatorioTexto";
import { nomeDoCriativo } from "@/components/marketing/mineracao/criativoTexto";
import { estruturaParaAgentes } from "../../../../shared/dissecacao-agentes";

/**
 * As saídas de uma análise de criativo para copiar — o mesmo desenho do relatório da Central de
 * Clientes (`MenuExportarRelatorio`): o documento é montado UMA vez, em Markdown
 * (`criativoParaMarkdown`), e o texto puro é a tradução dele (`markdownParaTexto`), para as duas
 * versões nunca divergirem. As outras saídas são recortes: a estrutura, o frase a frase e a
 * estrutura para agentes de IA.
 *
 * Lógica pura, fora do componente: testável, e o fast refresh só funciona em arquivo que exporta
 * só componente.
 */

type CriativoExportavel = Pick<SpyCriativo, "titulo" | "ad" | "especialidades" | "criado_em" | "dissecacao" | "dissecacao_md"> &
  Partial<Pick<SpyCriativo, "origem" | "cliente">>;

const SECOES_TECNICAS: { chave: keyof SpyDissecacaoCriativo; titulo: string }[] = [
  { chave: "formato", titulo: "Formato" },
  { chave: "anatomia_semantica", titulo: "Anatomia semântica" },
  { chave: "anatomia_psicologica", titulo: "Anatomia psicológica" },
];

const SEM_EVIDENCIA = "Sem evidência suficiente na peça.";

/** As duas estruturas como texto: a simplificada (blocos) e a invisível (movimentos). */
export function estruturaComoTexto(d: SpyDissecacaoCriativo): string {
  const blocos = d.blocos ?? [];
  const movimentos = d.movimentos ?? [];
  return [
    "ESTRUTURA SIMPLIFICADA",
    ...blocos.map((b, i) => `${i + 1}. ${b.nome}`),
    "",
    "ESTRUTURA INVISÍVEL",
    movimentos.map((m) => m.nome).join("\n↓\n"),
  ]
    .join("\n")
    .trim();
}

/** O frase a frase como texto: cada frase, a original quando traduzida, as funções e o porquê. */
export function fraseAFraseComoTexto(d: SpyDissecacaoCriativo): string {
  const frases = d.frases ?? [];
  const bloco = (lista: typeof frases) =>
    lista
      .map((f) =>
        [
          `"${f.texto}"`,
          f.original ? `(original: "${f.original}")` : null,
          `→ ${f.funcoes.length ? `${f.funcoes.join(", ")}: ` : ""}${f.explicacao}`,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
  const fala = frases.filter((f) => f.origem === "fala");
  const texto = frases.filter((f) => f.origem === "texto");
  return [bloco(fala), texto.length ? `TEXTO DO ANÚNCIO\n\n${bloco(texto)}` : null].filter(Boolean).join("\n\n").trim();
}

/** Quem é a peça, em uma linha: anunciante (ou cliente), especialidade e data da análise. */
function linhaDeOrigem(c: CriativoExportavel) {
  const quem = c.origem === "cliente" ? `Criativo do cliente${c.cliente ? ` ${c.cliente}` : ""}` : c.ad?.page_name || null;
  const data = c.criado_em ? new Date(c.criado_em).toLocaleDateString("pt-BR") : null;
  return [quem, c.especialidades?.join(", ") || null, data ? `analisado em ${data}` : null].filter(Boolean).join(" · ");
}

/** A análise inteira em Markdown — para Notion, ClickUp ou um doc. */
export function criativoParaMarkdown(c: CriativoExportavel): string {
  const d = c.dissecacao;
  const partes: string[] = [`# ${nomeDoCriativo(c)}`];
  const origem = linhaDeOrigem(c);
  if (origem) partes.push(origem);

  if (!d) {
    // Sem o bloco estruturado, o texto que o agente escreveu é a análise.
    partes.push("", String(c.dissecacao_md ?? "").trim() || SEM_EVIDENCIA);
    return partes.join("\n").trim();
  }

  if (d.versao === 2) {
    const blocos = d.blocos ?? [];
    const movimentos = d.movimentos ?? [];
    if (blocos.length) partes.push("", "## Estrutura simplificada", ...blocos.map((b, i) => `${i + 1}. ${b.nome}`));
    if (movimentos.length) partes.push("", "## Estrutura invisível", movimentos.map((m) => m.nome).join("\n↓\n"));
    const frases = d.frases ?? [];
    if (frases.length) {
      partes.push("", "## Frase a frase");
      const linha = (f: (typeof frases)[number]) =>
        [
          `> "${f.texto}"`,
          f.original ? `> *Original: "${f.original}"*` : null,
          "",
          `→ ${f.funcoes.length ? `**${f.funcoes.join(", ")}**: ` : ""}${f.explicacao}`,
          "",
        ]
          .filter((x) => x !== null)
          .join("\n");
      partes.push(...frases.filter((f) => f.origem === "fala").map(linha));
      const doTexto = frases.filter((f) => f.origem === "texto");
      if (doTexto.length) partes.push("### Texto do anúncio", "", ...doTexto.map(linha));
    }
  } else if (d.estrutura) {
    partes.push("", "## Estrutura", d.estrutura);
  }

  for (const { chave, titulo } of SECOES_TECNICAS) {
    partes.push("", `## ${titulo}`, String(d[chave] || "") || SEM_EVIDENCIA);
  }
  partes.push(
    "",
    "## Nível de consciência",
    d.nivel_consciencia ? NIVEL_CONSCIENCIA_LABEL[d.nivel_consciencia] : SEM_EVIDENCIA,
  );
  return partes
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A análise inteira em texto puro — para WhatsApp, e-mail ou um campo que não formata nada. */
export function criativoParaTexto(c: CriativoExportavel): string {
  return markdownParaTexto(criativoParaMarkdown(c));
}

/** O que cada recorte tem: os itens do menu ficam desabilitados quando a análise não tem aquilo. */
export function recortesDoCriativo(c: Pick<SpyCriativo, "dissecacao">) {
  const d = c.dissecacao;
  return {
    estrutura: Boolean(d && ((d.blocos?.length ?? 0) || (d.movimentos?.length ?? 0))),
    fraseAFrase: Boolean(d?.frases?.length),
    agentes: Boolean(d && estruturaParaAgentes(d)),
  };
}
