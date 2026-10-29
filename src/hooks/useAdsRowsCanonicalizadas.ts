import { useMemo } from "react";
import { useClientesData } from "@/hooks/useClientesData";
import {
  adsMedicoForClient,
  canonicalizeAdsClient,
  foldMergedAdsClient,
} from "@/data/clienteAliases";

/**
 * Linhas de anúncio já canonicalizadas, prontas para entrar em `useCRMClienteData` como
 * `externalAdsRows`.
 *
 * **Por que isto existe:** o fetch INTERNO do `useCRMClienteData` seleciona o `Client` cru e usa só
 * `normalizeClientName`, que não remove o sufixo "- CA x.y.z | Groohub" — e por isso os anúncios não
 * casavam com o CRM. O caminho certo é o `canonicalMap` do `useClientesData`, que é o que a página de
 * CRM faz. Quem pula esse passo obtém investimento e leads de tráfego DIFERENTES do que a tela de CRM
 * mostra para o mesmo período, o que é exatamente a contradição que o Relatório existe para não ter.
 *
 * As duas cópias originais desta transformação estão em `src/pages/ClientesCRM.tsx:68-82` e
 * `src/components/clientes/crm/CRMComparacaoPeriodos.tsx:328-343`. Elas continuam inline: são telas
 * sem cobertura de teste e em uso diário, e migrá-las só por elegância arriscaria um erro de número
 * silencioso. Se um dia alguém mexer na regra, é aqui que ela deve passar a morar — e as duas de lá
 * devem vir junto, no mesmo commit.
 *
 * @param adsScopeNames Nomes CRUS das contas de anúncio, para escopar o fetch de um usuário-cliente.
 *                      `undefined` (equipe interna) traz tudo.
 */
export function useAdsRowsCanonicalizadas(
  dateFrom: string,
  dateTo: string,
  adsScopeNames?: string[],
) {
  const { data, canonicalMap, clients, loading, error } = useClientesData(
    dateFrom,
    dateTo,
    adsScopeNames,
  );

  const adsRows = useMemo(
    () =>
      data.map((r) => ({
        Client: canonicalMap.canonicalByAdsName.get(r.Client) || foldMergedAdsClient(canonicalizeAdsClient(r.Client)),
        // `Dia` preservado para a evolução mensal de investimento/leads de tráfego.
        Dia: r.Dia,
        Lead: r.Lead,
        Mensagens_iniciadas: r.Conversa,
        Valor_usado_BRL: r.Valor_usado_BRL,
        Fonte_Ads: r.Fonte_Ads,
        // Médico dono da conta, derivado do nome CRU do Ads (antes da fusão do cliente): é o que
        // permite dividir o leads de tráfego entre médicos que compartilham um cliente do CRM.
        medico: adsMedicoForClient(r.Client),
      })),
    [data, canonicalMap],
  );

  return { adsRows, canonicalMap, clients, loading, error };
}
