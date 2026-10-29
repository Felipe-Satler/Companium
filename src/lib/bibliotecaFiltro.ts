import type { LibraryEntrySummary } from "@/lib/adSpyApi";
import { norm } from "@/lib/texto";

/**
 * Busca por nome e recorte por favoritos, em memória.
 *
 * Em memória de propósito: a lista da Biblioteca já vem inteira (teto de 100 no worker), e ir ao
 * servidor a cada tecla só somaria espera. O filtro por especialidade continua no servidor, onde
 * existe o índice `gin`.
 *
 * A busca olha título E tema porque salvar sem título é comum — aí o tema é o único nome que a
 * análise tem.
 */
export function filtrarAnalises(
  entries: LibraryEntrySummary[],
  { busca = "", soFavoritos = false }: { busca?: string; soFavoritos?: boolean },
): LibraryEntrySummary[] {
  const termo = norm(busca.trim());
  return entries.filter((e) => {
    if (soFavoritos && !e.favorito) return false;
    if (!termo) return true;
    return norm(`${e.titulo ?? ""} ${e.tema}`).includes(termo);
  });
}
