// Artes estáticas (Composer › Estático). Moram no mesmo worker da Mineração (`/api/spy`), então a
// requisição e o tratamento de erro vêm de `adSpyApi`.

import { spyRequest } from "@/lib/adSpyApi";
import type { BrandKit, ElementoDaArteId } from "../../shared/brand-kit";
import type { AvisoDoPost, PostRenderizavel, SlideDoPost } from "../../shared/post-templates";
import type { FundoDoPost } from "../../shared/fundos";
import type { OndeIdentificar, UsoDaArte } from "../../shared/regras-identificacao";

const BASE = (import.meta.env.VITE_SPY_ENDPOINT as string | undefined) ?? "/api/spy";

export type TipoDeFoto = "medico" | "procedimento" | "estrutura" | "equipe" | "outro";

export type FotoDaArte = { caminho: string; tipo: TipoDeFoto; descricao: string };

/** O que a pré-etapa decide. */
export type OpcoesDaArte = {
  uso: UsoDaArte;
  circula_fora: boolean;
  onde_identificar: OndeIdentificar;
  elementos: Partial<Record<ElementoDaArteId, boolean>>;
  fotos: FotoDaArte[];
};

export type MarcaCopiada = Pick<BrandKit, "nome_clinica" | "paleta" | "fontes" | "contatos" | "enderecos"> & {
  imagens: { logo: string | null; logo_escuro: string | null };
};

export type Arte = {
  id: string;
  composition_id: string | null;
  anuncio_indice: number;
  cliente: string;
  nome_exibicao: string | null;
  formato_origem: string | null;
  opcoes: OpcoesDaArte & { template: string; proporcao: string };
  marca: MarcaCopiada;
  post: PostRenderizavel | null;
  avisos: AvisoDoPost[];
  /** running = o agente está destrinchando (a tela faz polling); pronta | error = terminou. */
  status: "running" | "pronta" | "error";
  error: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  canDelete?: boolean;
  /** O anúncio de origem mudou depois desta arte. Só no GET de uma. */
  desatualizada?: boolean;
};

export const enviarFotoDaArte = (token: string, cliente: string, arquivo: File) =>
  spyRequest<{ caminho: string }>(`/artes/fotos?cliente=${encodeURIComponent(cliente)}`, token, {
    method: "POST",
    body: arquivo,
    headers: { "Content-Type": arquivo.type || "application/octet-stream" },
  });

export const criarArte = (
  token: string,
  input: { compositionId: string; indice: number; opcoes: Omit<OpcoesDaArte, "fotos"> & { fotos: FotoDaArte[] } }
) =>
  spyRequest<{ id: string; status: Arte["status"] }>("/artes", token, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const listarArtes = (token: string, filtro: { compositionId?: string; indice?: number; cliente?: string }) => {
  const q = new URLSearchParams();
  if (filtro.compositionId) q.set("compositionId", filtro.compositionId);
  if (filtro.indice != null) q.set("indice", String(filtro.indice));
  if (filtro.cliente) q.set("cliente", filtro.cliente);
  return spyRequest<{ artes: Arte[] }>(`/artes?${q.toString()}`, token);
};

export const obterArte = (token: string, id: string) =>
  spyRequest<{ arte: Arte }>(`/artes/${encodeURIComponent(id)}`, token);

export const ajustarArte = (
  token: string,
  id: string,
  ajuste: { slides: SlideDoPost[]; legenda: string; hashtags: string[]; fundo?: FundoDoPost | null }
) =>
  spyRequest<{ post: PostRenderizavel; avisos: AvisoDoPost[] }>(`/artes/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(ajuste),
  });

export const apagarArte = (token: string, id: string) =>
  spyRequest<{ ok: true }>(`/artes/${encodeURIComponent(id)}`, token, { method: "DELETE" });

export const urlDaFotoDaArte = (id: string, n: number) => `${BASE}/artes/${encodeURIComponent(id)}/fotos/${n}`;

/**
 * O arquivo de UMA página, renderizado pelo worker. Sem `spyRequest`: a resposta é a imagem, e os
 * avisos do render vêm num cabeçalho.
 */
export async function baixarSlide(
  token: string,
  id: string,
  indice: number,
  formato: "jpeg" | "png" = "jpeg"
): Promise<{ blob: Blob; nome: string; avisos: { campo: string; tipo: string; detalhe: string }[] }> {
  const res = await fetch(`${BASE}/artes/${encodeURIComponent(id)}/render`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ indice, formato }),
  });
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    throw new Error(corpo?.error || `Não foi possível gerar o arquivo (${res.status}).`);
  }
  const disposicao = res.headers.get("content-disposition") || "";
  const nome = /filename="([^"]+)"/i.exec(disposicao)?.[1] || `arte-${indice + 1}.${formato === "png" ? "png" : "jpg"}`;
  let avisos = [];
  try {
    avisos = JSON.parse(decodeURIComponent(res.headers.get("x-avisos-render") || "%5B%5D"));
  } catch {
    avisos = [];
  }
  return { blob: await res.blob(), nome, avisos };
}

export function salvarArquivo(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
