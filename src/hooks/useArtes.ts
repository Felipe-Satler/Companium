/**
 * As artes estáticas da Oficina de Artes: uma arte (com polling enquanto o agente destrincha), as de
 * um anúncio, as da carteira inteira (Artes Salvas) e as imagens que o preview precisa.
 *
 * As imagens (logo do Brand kit, fotos da arte) vêm do bucket privado pelo worker, que exige o
 * token — e `<img src>` não sabe mandar token —, então viram blob URL, como no `useSpyMedia`.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { urlDaImagemDoKit } from "@/lib/brandKitApi";
import { listarArtes, obterArte, urlDaFotoDaArte, type Arte } from "@/lib/artesApi";
import type { ImagensDaArte } from "@/posts/tipos";

const POLL_MS = 2500;

export const chaveDaArte = (id: string | null) => ["marketing-arte", id];
export const chaveDasArtesDoAnuncio = (compositionId: string | null, indice: number | null) => [
  "marketing-artes",
  compositionId,
  indice,
];
export const CHAVE_ARTES_SALVAS = ["marketing-artes", "salvas"];

export function useToken() {
  const { session } = useAuth();
  return session?.access_token ?? "";
}

const algumaRodando = (artes: Arte[] | undefined) => (artes ?? []).some((a) => a.status === "running");

/** Uma arte. Pergunta de novo enquanto o agente destrincha. */
export function useArte(id: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: chaveDaArte(id),
    enabled: Boolean(token && id),
    queryFn: () => obterArte(token, id as string).then((r) => r.arte),
    refetchInterval: (q) => (q.state.data?.status === "running" ? POLL_MS : false),
    staleTime: 0,
  });
}

/** As artes de UM anúncio de uma composição, mais recentes primeiro. */
export function useArtesDoAnuncio(compositionId: string | null, indice: number | null) {
  const token = useToken();
  return useQuery({
    queryKey: chaveDasArtesDoAnuncio(compositionId, indice),
    enabled: Boolean(token && compositionId && indice != null),
    queryFn: () => listarArtes(token, { compositionId: compositionId!, indice: indice! }).then((r) => r.artes),
    refetchInterval: (q) => (algumaRodando(q.state.data) ? POLL_MS : false),
  });
}

/** As artes da carteira inteira — a aba Artes Salvas. Os filtros são aplicados na tela. */
export function useArtesSalvas() {
  const token = useToken();
  return useQuery({
    queryKey: CHAVE_ARTES_SALVAS,
    enabled: Boolean(token),
    queryFn: () => listarArtes(token, {}).then((r) => r.artes),
    refetchInterval: (q) => (algumaRodando(q.state.data) ? POLL_MS : false),
    staleTime: 0,
  });
}

/**
 * Blob URLs por (url, versão), compartilhados entre os componentes: a grade de Artes Salvas mostra
 * dezenas de cards do mesmo cliente, e cada um pedir o mesmo logo ao worker seria dezenas de
 * downloads iguais. Não são revogados — são poucos (um logo por cliente, uma foto por card) e vivem
 * enquanto a aba vive.
 */
const cacheDeImagens = new Map<string, Promise<string | null>>();

function buscarImagem(url: string, token: string, versao: string) {
  const chave = `${url}#${versao}`;
  let pedido = cacheDeImagens.get(chave);
  if (!pedido) {
    pedido = fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    // Falha não fica em cache: a próxima tela tenta de novo.
    pedido.then((u) => {
      if (!u) cacheDeImagens.delete(chave);
    });
    cacheDeImagens.set(chave, pedido);
  }
  return pedido;
}

/** Várias imagens atrás do token, na ordem; `null` na posição que não tem imagem. */
export function useImagens(pedidos: ({ url: string; versao: string } | null)[], token: string) {
  const [urls, setUrls] = useState<(string | null)[]>(() => pedidos.map(() => null));
  const chave = pedidos.map((p) => (p ? `${p.url}#${p.versao}` : "")).join("|");
  useEffect(() => {
    let vivo = true;
    if (!token) return;
    Promise.all(pedidos.map((p) => (p ? buscarImagem(p.url, token, p.versao) : Promise.resolve(null)))).then(
      (lista) => vivo && setUrls(lista)
    );
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, token]);
  return urls;
}

/**
 * As imagens que o template precisa para desenhar esta arte: o logo (claro e escuro) e as fotos.
 * `soDoSlide` limita as fotos às que aquele slide usa — é o que a miniatura da grade pede.
 *
 * O logo vem da rota do Brand kit (o atual); a versão é o caminho guardado na arte, então ele só
 * muda se alguém trocar o logo no kit. O render do worker usa a cópia da arte primeiro.
 */
export function useImagensDaArte(arte: Arte | null, { soDoSlide = null }: { soDoSlide?: number | null } = {}): ImagensDaArte {
  const token = useToken();
  const fotos = arte?.opcoes?.fotos ?? [];
  const fotoDoSlide = soDoSlide != null ? arte?.post?.slides[soDoSlide]?.foto ?? null : null;
  const pedidos = [
    arte?.marca?.imagens?.logo ? { url: urlDaImagemDoKit(arte.cliente, "logo"), versao: arte.marca.imagens.logo } : null,
    arte?.marca?.imagens?.logo_escuro
      ? { url: urlDaImagemDoKit(arte.cliente, "logo_escuro"), versao: arte.marca.imagens.logo_escuro }
      : null,
    ...fotos.map((f, n) =>
      arte && (soDoSlide == null || fotoDoSlide === n) ? { url: urlDaFotoDaArte(arte.id, n), versao: f.caminho } : null
    ),
  ];
  const [logo, logoEscuro, ...resto] = useImagens(pedidos, token);
  return { logo, logo_escuro: logoEscuro, fotos: resto.map((u) => u ?? "") };
}
