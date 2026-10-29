/**
 * O Brand kit de um cliente, e as imagens dele.
 *
 * Sem polling: ninguém escreve o kit em segundo plano. As imagens vêm do bucket privado pelo worker,
 * que exige o token — e `<img src>` não sabe mandar token —, então são buscadas como blob, a mesma
 * receita do `useSpyMedia` da Mineração.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { obterBrandKit, type BrandKitResposta } from "@/lib/brandKitApi";

export const chaveDoBrandKit = (cliente: string) => ["marketing-brand-kit", cliente];

export function useBrandKit(cliente: string | null, enabled = true) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: chaveDoBrandKit(cliente ?? ""),
    enabled: Boolean(token) && Boolean(cliente) && enabled,
    queryFn: () => obterBrandKit(token, cliente as string),
    staleTime: 60 * 1000,
  });
  return {
    ...query,
    token,
    /** Troca o que está em cache pelo que o worker devolveu, sem reler. */
    gravar: (resposta: Partial<BrandKitResposta>) =>
      qc.setQueryData<BrandKitResposta>(chaveDoBrandKit(cliente ?? ""), (atual) =>
        atual ? { ...atual, ...resposta } : (resposta as BrandKitResposta)
      ),
  };
}

/**
 * Uma imagem atrás do token, como blob URL. `versao` é o que força a releitura quando a imagem muda
 * na MESMA URL (o caminho no bucket muda a cada upload, a rota não).
 */
export function useImagemAutenticada(url: string | null, token: string, versao: string | null) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    setBlobUrl(null);
    if (!url || !token || !versao) return;
    let objectUrl: string | null = null;
    let cancelado = false;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelado || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        /* imagem ausente: quem usa mostra o espaço vazio */
      });
    return () => {
      cancelado = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, token, versao]);

  return blobUrl;
}
