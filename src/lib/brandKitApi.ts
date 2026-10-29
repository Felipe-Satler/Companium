// Brand kit da Central de Clientes. Mora no mesmo worker da Mineração (`/api/spy`), então a
// requisição e o tratamento de erro vêm de `adSpyApi` — inclusive as mensagens que distinguem
// "falta o bloco do nginx" de "o worker está rodando código velho".

import { spyRequest } from "@/lib/adSpyApi";
import type { BrandKit, ImagemDoKitId } from "../../shared/brand-kit";

const BASE = (import.meta.env.VITE_SPY_ENDPOINT as string | undefined) ?? "/api/spy";

/** A identificação que o Estudo de Copy deu na composição mais recente — a sugestão de preenchimento. */
export type IdentificacaoDoEstudo = {
  nome?: string | null;
  crm?: string | null;
  rqe?: string | null;
  /** Quando foi a composição de onde ela saiu. */
  de: string;
} | null;

export type BrandKitResposta = {
  kit: BrandKit;
  atualizado_em: string | null;
  identificacaoDoEstudo?: IdentificacaoDoEstudo;
};

/** O 400 do salvar traz o que foi recusado, campo a campo — a tela mostra ao lado de cada um. */
export class ErroDoKit extends Error {
  erros: { campo: string; detalhe: string }[];
  constructor(message: string, erros: { campo: string; detalhe: string }[]) {
    super(message);
    this.erros = erros;
  }
}

const rota = (cliente: string) => `/clientes/${encodeURIComponent(cliente)}/brand-kit`;

export const obterBrandKit = (token: string, cliente: string) =>
  spyRequest<BrandKitResposta>(rota(cliente), token);

export async function salvarBrandKit(token: string, cliente: string, kit: BrandKit) {
  // Sem `spyRequest` aqui: ele transforma o 400 numa mensagem só, e o que importa do 400 deste
  // salvar é a lista de campos.
  const res = await fetch(`${BASE}${rota(cliente)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kit }),
  });
  const corpo = await res.json().catch(() => null);
  if (res.status === 400 && Array.isArray(corpo?.erros)) throw new ErroDoKit(corpo.error, corpo.erros);
  if (!res.ok) throw new Error(corpo?.error || `Não foi possível salvar o Brand kit (${res.status}).`);
  return corpo as BrandKitResposta;
}

export const urlDaImagemDoKit = (cliente: string, tipo: ImagemDoKitId) =>
  `${BASE}${rota(cliente)}/imagens/${tipo}`;

export const enviarImagemDoKit = (token: string, cliente: string, tipo: ImagemDoKitId, arquivo: File) =>
  spyRequest<{ imagens: BrandKit["imagens"] }>(`${rota(cliente)}/imagens/${tipo}`, token, {
    method: "PUT",
    body: arquivo,
    headers: { "Content-Type": arquivo.type || "application/octet-stream" },
  });

export const removerImagemDoKit = (token: string, cliente: string, tipo: ImagemDoKitId) =>
  spyRequest<{ imagens: BrandKit["imagens"] }>(`${rota(cliente)}/imagens/${tipo}`, token, {
    method: "DELETE",
  });
