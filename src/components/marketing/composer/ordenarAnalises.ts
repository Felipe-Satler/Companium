import type { LibraryEntrySummary } from "@/lib/adSpyApi";

/**
 * Análises ordenadas por relevância PARA ESTE CLIENTE.
 *
 * A Biblioteca é da equipe inteira e cresce sem parar. Sem esta ordenação, compor para um
 * cardiologista começaria rolando dezenas de análises de harmonização facial — e o caminho mais
 * curto viraria não escolher análise nenhuma, que é justamente o que a ferramenta existe para
 * evitar.
 *
 * O que não casa NÃO some: uma análise de outro nicho pode ser exatamente o que se quer copiar.
 * Só deixa de vir primeiro.
 *
 * Mora fora do componente porque é lógica pura e testável — e porque exportar função de um arquivo
 * de componente quebra o fast refresh do Vite.
 */
export function ordenarAnalises(
  entries: LibraryEntrySummary[],
  especialidadesDoCliente: string[],
): { entry: LibraryEntrySummary; casa: boolean }[] {
  const alvo = new Set(especialidadesDoCliente);
  return entries
    .map((entry) => ({
      entry,
      casa: alvo.size > 0 && entry.especialidades.some((e) => alvo.has(e)),
    }))
    .sort((a, b) => {
      if (a.casa !== b.casa) return a.casa ? -1 : 1;
      // Dentro do mesmo grupo, a mais recente primeiro — é a ordem em que a Biblioteca já mostra.
      return b.entry.criado_em.localeCompare(a.entry.criado_em);
    });
}
