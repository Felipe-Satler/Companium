/**
 * Um relatório -> markdown completo, para colar em outro lugar.
 *
 * **Não é `relatorio_md`.** Aquele campo é só a prosa do agente; a tela mostra mais do que ele — a
 * prioridade tipada, a tabela de números que embasou o texto, os avisos de máquina e as limitações
 * declaradas. Copiar só a prosa entregaria um diagnóstico sem os números que o sustentam, e quem
 * recebesse não teria como conferir nada. Então o que se copia é o documento INTEIRO, montado daqui.
 *
 * Os números saem do `snapshot` gravado, como na tela, e pela mesma razão: um relatório de agosto
 * colado em dezembro tem de levar os números de agosto. Recalcular aqui faria o texto copiado
 * discordar da tela de onde foi copiado.
 *
 * As três situações de um valor continuam distinguidas no texto — "sem informação", "não calculável"
 * e um zero de verdade são coisas diferentes, e achatá-las em "0" ou "—" na exportação seria desfazer
 * no último metro a honestidade que o resto do pipeline mantém.
 */

import type { Relatorio } from "@/lib/clientReportsApi";
import type { MetricaSnapshot } from "@/utils/relatorioSnapshot";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const PRIORIDADE_LABEL: Record<string, string> = {
  gargalo: "Gargalo",
  investigacao: "Investigação",
  oportunidade: "Oportunidade",
};

const TIPO_CAUSA_LABEL: Record<string, string> = {
  causa: "causa comprovada",
  correlacao: "correlação",
  hipotese: "hipótese",
};

/** dd/mm/aaaa a partir de YYYY-MM-DD, sem passar por `Date` (evita o deslocamento de fuso). */
function dataBR(iso: string | null | undefined) {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : String(iso);
}

/** O valor de uma ponta, com as três situações distinguidas. */
function valor(p: MetricaSnapshot["a"] | null | undefined, unidade: string) {
  if (!p || p.disponivel === false) return "sem informação";
  if (p.valor === null || p.valor === undefined) return "não calculável";
  if (unidade === "moeda") return BRL.format(p.valor);
  if (unidade === "ratio") return `${p.valor.toFixed(2).replace(".", ",")}x`;
  return NUM.format(p.valor);
}

/** Escapa o que quebraria uma célula de tabela markdown. */
const celula = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");

function tabelaNumeros(metricas: MetricaSnapshot[], comparativo: boolean): string[] {
  if (!metricas.length) return [];
  const linhas: string[] = [];
  linhas.push("## Números que embasaram");
  linhas.push("");
  linhas.push(comparativo ? "| Métrica | Período | Comparação | Meta |" : "| Métrica | Período | Meta |");
  linhas.push(comparativo ? "| --- | --- | --- | --- |" : "| --- | --- | --- |");

  for (const m of metricas) {
    const a = valor(m.a, m.unidade);
    const b = comparativo ? valor(m.b, m.unidade) : null;
    // Meta ausente é "sem meta", não zero: cliente sem meta cadastrada não é cliente com meta zero.
    const meta = m.meta?.a?.valor === null || m.meta?.a?.valor === undefined
      ? "sem meta"
      : valor({ valor: m.meta.a.valor, disponivel: true } as MetricaSnapshot["a"], m.unidade);
    // `corrigido` é da PONTA, não da métrica: a correção manual vale para um período, e marcar a
    // linha inteira diria que o número da comparação também foi mexido.
    const temCorrecao = m.a?.corrigido || (comparativo && m.b?.corrigido);
    const rotulo = celula(temCorrecao ? `${m.label} (corrigido à mão)` : m.label);
    linhas.push(
      comparativo
        ? `| ${rotulo} | ${celula(a)} | ${celula(b ?? "")} | ${celula(meta)} |`
        : `| ${rotulo} | ${celula(a)} | ${celula(meta)} |`,
    );
  }
  linhas.push("");
  return linhas;
}

/** O nome que o relatório tem na tela: o título dado pela pessoa, ou o rótulo do período. */
export function nomeDoRelatorio(r: Pick<Relatorio, "titulo" | "periodo_label" | "periodo_de" | "periodo_ate">) {
  const t = (r.titulo ?? "").trim();
  if (t) return t;
  return r.periodo_label || `${dataBR(r.periodo_de)} a ${dataBR(r.periodo_ate)}`;
}

export function relatorioParaMarkdown(r: Relatorio): string {
  const out: string[] = [];
  const blocos = r.relatorio;

  out.push(`# ${nomeDoRelatorio(r)}`);
  out.push("");

  const cabecalho: string[] = [];
  if (r.nome_exibicao || r.cliente) cabecalho.push(`**Cliente:** ${r.nome_exibicao || r.cliente}`);
  cabecalho.push(`**Período:** ${dataBR(r.periodo_de)} a ${dataBR(r.periodo_ate)}`);
  if (r.comparacao_de && r.comparacao_ate) {
    cabecalho.push(`**Comparado com:** ${dataBR(r.comparacao_de)} a ${dataBR(r.comparacao_ate)}`);
  }
  if (blocos?.problema.prioridade) {
    cabecalho.push(`**Prioridade:** ${PRIORIDADE_LABEL[blocos.problema.prioridade]}`);
  } else if (blocos) {
    // O agente não chuta entre gargalo e oportunidade, e o texto copiado diz isso — some-lo daria a
    // impressão de que ninguém classificou por esquecimento.
    cabecalho.push("**Prioridade:** não classificada");
  }
  out.push(cabecalho.join("  \n"));
  out.push("");

  if (r.observacao) {
    out.push(`> **Foco pedido:** ${r.observacao}`);
    out.push("");
  }

  if (blocos?.leitura) {
    out.push("## Leitura crítica", "", blocos.leitura.trim(), "");
  }

  if (blocos?.problema?.texto) {
    out.push("## Problema / oportunidade", "", blocos.problema.texto.trim(), "");
    if (blocos.problema.impacto) out.push(`**Impacto:** ${blocos.problema.impacto.trim()}`, "");
    if (blocos.problema.criativos?.length) {
      out.push(`**Criativos citados:** ${blocos.problema.criativos.join(", ")}`, "");
    }
  }

  if (blocos?.causa?.texto) {
    out.push("## Causa / correlação", "");
    // O TIPO viaja junto do texto: "hipótese" e "causa comprovada" pedem decisões diferentes de quem
    // lê, e sem o rótulo as duas chegam com o mesmo peso.
    out.push(`*(${TIPO_CAUSA_LABEL[blocos.causa.tipo] ?? blocos.causa.tipo})* ${blocos.causa.texto.trim()}`, "");
    if (blocos.causa.verificar) out.push(`**Como verificar:** ${blocos.causa.verificar.trim()}`, "");
  }

  if (blocos?.acao?.texto) {
    out.push("## Ação recomendada", "", blocos.acao.texto.trim(), "");
    out.push(`**Responsável:** ${blocos.acao.responsavel || "a definir"}  `);
    out.push(`**Prazo:** ${blocos.acao.prazo || "a definir"}`);
    out.push("");
  }

  const metricas = r.snapshot?.metricas ?? [];
  out.push(...tabelaNumeros(metricas, Boolean(r.comparacao_de && r.comparacao_ate)));

  if (blocos?.limitacoes?.length) {
    out.push("## Limitações declaradas", "");
    for (const l of blocos.limitacoes) out.push(`- ${l}`);
    out.push("");
  }

  const avisos = r.avisos ?? [];
  if (avisos.length) {
    out.push("## Avisos sobre os dados", "");
    for (const a of avisos) out.push(`- ${a.detalhe}`);
    out.push("");
  }

  // A procedência fecha o documento porque é o que torna o texto conferível meses depois: quem
  // escreveu, quando, e de onde vieram os números. Sem isso, um markdown colado num e-mail é
  // indistinguível de um texto que alguém digitou.
  const quando = r.criado_em ? new Date(r.criado_em).toLocaleString("pt-BR") : null;
  out.push("---", "");
  out.push(
    `*Gerado por ${r.agent_id || "agente"} em ${quando ?? "data desconhecida"}. ` +
      `Números de origem \`${r.origem_numeros || "frontend"}\`, conforme exibidos no dashboard no ` +
      "momento da geração.*",
  );

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
