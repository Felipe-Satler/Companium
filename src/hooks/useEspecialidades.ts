import { useState, useEffect, useCallback } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { clientMatchKey, canonicalizeAdsClient } from "@/data/clienteAliases";

// Linha da view `v_cliente_especialidades` (clientes + cliente_contas, gated por is_approved).
// Uma linha por (cliente, conta-crua); `nome_bruto` é null quando o cliente não tem conta.
interface EspRow {
  nome_identificador: string;
  nome_bruto: string | null;
  especialidades: string[];
}

// Normalização de typos/sinônimos cadastrados na tabela `clientes` — para o filtro não
// fragmentar (ex.: "cirugia plástica" e "cirurgia plástica" virariam duas opções).
// Chave = valor cru em lowercase já trimado. Mantido pequeno e explícito (fácil auditar).
const ESP_NORMALIZE: Record<string, string> = {
  "cirugia plástica": "Cirurgia Plástica",
  "desmatologia": "Dermatologia",
  "endócrino": "Endocrinologia",
  "urologista": "Urologia",
  "traumatologista": "Traumatologia",
};

// Conectivos ficam minúsculos (exceto se forem a 1ª palavra) para o rótulo bater EXATAMENTE
// com a planilha oficial: "Clínica de Estética", "Medicina da Família" (e não "De"/"Da").
const TITLE_CONNECTORS = new Set(["de", "da", "do", "das", "dos", "e"]);
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && TITLE_CONNECTORS.has(w.toLocaleLowerCase("pt-BR"))) return w.toLocaleLowerCase("pt-BR");
      return w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1);
    })
    .join(" ");
}

/** Formata uma especialidade crua da base para exibição (normaliza typos + Title Case). */
export function formatEspecialidade(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (ESP_NORMALIZE[key]) return ESP_NORMALIZE[key];
  return titleCase(raw.trim());
}

// Pontes para os poucos clientes cujo slug canônico do relatório (estilo Kommo/Ads) NÃO
// bate por `clientMatchKey` com o `nome_identificador` da tabela `clientes`. As contas cruas
// (`nome_bruto`) já cobrem a maioria via canonicalizeAdsClient; estes são os residuais cujas
// contas estão todas no "balde groohub" ou ausentes. chave = matchKey(slug) → matchKey(nome_id).
const CANONICAL_ESP_ALIASES: Record<string, string> = {
  [clientMatchKey("Vista_Nova")]: clientMatchKey("centro oftalmologico vista nova"),
  [clientMatchKey("Carlos_Sena")]: clientMatchKey("carlos sena filho"),
  // Aurelio agora canonicaliza p/ "Aurelio_Oliveira" (= nome_identificador "aurelio oliveira"),
  // então o match é direto — não precisa mais de ponte.
  [clientMatchKey("Fabio_Morais")]: clientMatchKey("fabio morais filho"),
  [clientMatchKey("Luis_Fernando")]: clientMatchKey("luis fernando barreto"),
  [clientMatchKey("Luis_Pacheco")]: clientMatchKey("luis felipe pacheco"),
  // Bellucci → Lia Garrido: o canônico agora é "Lia_Garrido", que já casa por clientMatchKey
  // com o nome_identificador "lia garrido" da tabela clientes — sem ponte necessária.
};

/**
 * Carrega as especialidades cadastradas por cliente (tabela `clientes`) e expõe:
 *  - `especialidadeOptions`: lista distinta ordenada (formatada) para o dropdown do filtro.
 *  - `getEspecialidades(canonical)`: especialidades de um cliente do relatório, casando o
 *    slug canônico (Kommo/Ads) com o `nome_identificador`/conta-crua da base.
 *
 * Matching: cada linha indexa por matchKey(nome_identificador) E por
 * matchKey(canonicalizeAdsClient(nome_bruto)) — assim os nomes longos de conta ("Dr. X - CA
 * 1.1.1 | Groohub") já canonicalizam para o mesmo slug do relatório, sem heurística manual.
 */
export function useEspecialidades() {
  const [byKey, setByKey] = useState<Map<string, Set<string>>>(new Map());
  const [especialidadeOptions, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await externalSupabase
          .from("v_cliente_especialidades")
          .select("nome_identificador,nome_bruto,especialidades");
        if (error) throw error;

        const map = new Map<string, Set<string>>();
        const optSet = new Set<string>();
        const add = (key: string, esps: string[]) => {
          if (!key || esps.length === 0) return;
          let set = map.get(key);
          if (!set) {
            set = new Set<string>();
            map.set(key, set);
          }
          for (const e of esps) set.add(e);
        };

        for (const row of (data || []) as EspRow[]) {
          const esps = (row.especialidades || [])
            .map(formatEspecialidade)
            .filter(Boolean);
          esps.forEach((e) => optSet.add(e));
          add(clientMatchKey(row.nome_identificador), esps);
          if (row.nome_bruto) add(clientMatchKey(canonicalizeAdsClient(row.nome_bruto)), esps);
        }

        if (cancelled) return;
        setByKey(map);
        setOptions([...optSet].sort((a, b) => a.localeCompare(b, "pt-BR")));
      } catch {
        if (!cancelled) {
          setByKey(new Map());
          setOptions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getEspecialidades = useCallback(
    (canonical: string): string[] => {
      if (!canonical) return [];
      const key = clientMatchKey(canonical);
      let set = byKey.get(key);
      if (!set && CANONICAL_ESP_ALIASES[key]) set = byKey.get(CANONICAL_ESP_ALIASES[key]);
      return set ? [...set].sort((a, b) => a.localeCompare(b, "pt-BR")) : [];
    },
    [byKey],
  );

  return { especialidadeOptions, getEspecialidades, loading };
}
