import { periodLabel } from "@/utils/dateRange";
import { diasNoPeriodo, type JanelaComparavel } from "../../shared/relatorio-metricas";

/**
 * A janela de comparação que vai ao snapshot do relatório — escolhida à mão ou vinda da regra.
 *
 * Mora fora do componente porque é a decisão que o relatório inteiro apoia, e porque um `useMemo`
 * dentro de uma aba cheia de hooks de dados não é testável sem montar a tela toda.
 *
 * ## `comparavel` é o campo que importa
 *
 * Ele não descreve a janela: ele AUTORIZA uma conclusão. `montarSnapshot` o transforma no aviso
 * `comparacao_incompativel`, e o prompt do agente o usa para proibir conclusão a partir de
 * contagem. Comparar 15 dias contra 30 e escrever "os leads caíram pela metade" é exatamente a
 * frase errada que este campo existe para impedir — e uma janela escolhida à mão é justamente onde
 * isso passa a ser possível, porque antes a regra garantia o tamanho.
 */
export type ComparacaoEscolhida = JanelaComparavel & { label: string };

export function montarComparacao({
  periodo,
  de,
  ate,
  sugestao,
}: {
  /** O período analisado, em ISO. */
  periodo: { de: string; ate: string };
  /** O período de comparação escolhido, em ISO. */
  de: string;
  ate: string;
  /** O que `janelaComparavel` sugeriu para este período, ou `null`. */
  sugestao: JanelaComparavel | null;
}): ComparacaoEscolhida {
  const label = periodLabel(new Date(`${de}T12:00:00`), new Date(`${ate}T12:00:00`));

  // Escolha igual à sugestão: viaja a REGRA inteira — `regra`, `motivo` e `comparavel` saem de
  // `janelaComparavel`, e o worker confere a mesma conta. Quem não mexe no seletor gera exatamente
  // o relatório que gerava antes deste campo existir.
  if (sugestao && sugestao.de === de && sugestao.ate === ate) return { ...sugestao, label };

  const dias = diasNoPeriodo(de, ate) ?? 0;
  const diasA = diasNoPeriodo(periodo.de, periodo.ate) ?? 0;
  return {
    de,
    ate,
    dias,
    regra: "manual",
    motivo:
      `Período de comparação escolhido à mão: ${dias} dia(s) contra ${diasA} do período analisado.` +
      (dias === diasA
        ? ""
        : " As contagens não são comparáveis entre janelas de tamanhos diferentes."),
    comparavel: dias === diasA && dias > 0,
    label,
  };
}
