/**
 * Documentos do ClickUp de um cliente.
 *
 * Sem polling, ao contrário do resumo e do relatório: não há agente escrevendo em segundo plano, a
 * resposta já é a lista. O que existe é CACHE — o worker guarda o índice do workspace por alguns
 * minutos e o react-query guarda a resposta por cliente —, então a tela mostra de quando é a leitura
 * e oferece um recarregar que atravessa os dois.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { listClientDocs, obterConteudoDocumento } from "@/lib/clientDocsApi";

const KEY = (cliente: string) => ["marketing-client-docs", cliente];

export function useClientDocs(cliente: string | null, enabled = true) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const qc = useQueryClient();
  const [recarregando, setRecarregando] = useState(false);

  const query = useQuery({
    queryKey: KEY(cliente ?? ""),
    // `enabled` é o que impede a aba fechada de ir ao ClickUp: o primeiro acesso depois de um
    // restart do worker pagina o workspace inteiro, e não há razão de pagar isso por um diálogo
    // aberto na aba de Contexto Operacional.
    enabled: Boolean(token) && Boolean(cliente) && enabled,
    queryFn: () => listClientDocs(token, cliente as string),
    // Documento não muda de minuto a minuto, e o worker já tem o cache dele.
    staleTime: 5 * 60 * 1000,
  });

  /** Recarrega de verdade: manda o worker descartar o índice e refaz a leitura. */
  const recarregar = async () => {
    if (!cliente || !token) return;
    setRecarregando(true);
    try {
      const fresco = await listClientDocs(token, cliente, true);
      qc.setQueryData(KEY(cliente), fresco);
    } finally {
      setRecarregando(false);
    }
  };

  return {
    documentos: query.data?.documentos ?? [],
    // Três estados distintos, e a tela depende de distinguir os três: carregando, não conseguimos
    // ler (`clickupIndisponivel`) e lemos mas não há documento (lista vazia).
    clickupIndisponivel: query.data ? query.data.fontes?.clickup === false : false,
    erro:
      query.data?.erro ??
      (query.error instanceof Error ? query.error.message : null),
    lidoEm: query.data?.lidoEm ?? null,
    truncado: Boolean(query.data?.truncado),
    isLoading: query.isLoading,
    recarregar,
    recarregando,
  };
}

/**
 * O conteúdo de UM documento, buscado só quando o preview abre.
 *
 * `enabled` pelo id: sem isso, abrir a etapa de insumos dispararia uma requisição por documento
 * listado. Cache longo porque documento não muda enquanto alguém escolhe insumos.
 */
export function useDocumentoConteudo(cliente: string | null, docId: string | null) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const query = useQuery({
    queryKey: ["client-doc-content", cliente, docId],
    enabled: Boolean(token && cliente && docId),
    queryFn: () => obterConteudoDocumento(token, cliente as string, docId as string),
    staleTime: 10 * 60 * 1000,
  });
  return {
    conteudoMd: query.data?.conteudo_md ?? null,
    // "não conseguimos ler" e "lemos e está vazio" são respostas diferentes, e a tela mostra qual.
    clickupIndisponivel: query.data ? query.data.fontes?.clickup === false : false,
    motivo: query.data?.erro ?? null,
    isLoading: query.isLoading,
  };
}
