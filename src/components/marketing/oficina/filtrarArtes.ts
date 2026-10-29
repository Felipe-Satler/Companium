import type { Arte } from "@/lib/artesApi";

export type FiltroDeArtes = {
  cliente: string | null;
  /** Vazio = todas. Uma arte passa se o cliente dela tem QUALQUER uma das escolhidas. */
  especialidades: string[];
  uso: "organico" | "pago" | null;
  formato: string | null;
};

/**
 * As artes que passam no filtro das Artes Salvas, na ordem em que vieram (mais recentes primeiro).
 *
 * A especialidade não está na arte: é do CLIENTE, e vem da mesma fonte da Central de Clientes
 * (`getEspecialidades`). Guardá-la na arte faria um cliente que mudou de especialidade ficar com as
 * artes antigas no filtro errado.
 */
export function filtrarArtes(artes: Arte[], filtro: FiltroDeArtes, getEspecialidades: (cliente: string) => string[]) {
  return artes.filter((a) => {
    if (filtro.cliente && a.cliente !== filtro.cliente) return false;
    if (filtro.uso && a.opcoes?.uso !== filtro.uso) return false;
    if (filtro.formato && a.formato_origem !== filtro.formato) return false;
    if (filtro.especialidades.length) {
      const doCliente = getEspecialidades(a.cliente) ?? [];
      if (!doCliente.some((e) => filtro.especialidades.includes(e))) return false;
    }
    return true;
  });
}
