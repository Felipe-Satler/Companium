/**
 * Gestão — download da planilha publicada na web.
 *
 * O Companium é uma SPA (Vite) e a planilha oficial é servida pelo endpoint
 * "Publicar na web" do Google (/pub?output=xlsx), que libera CORS. Por isso o
 * download é feito direto no navegador — não há a server function do pacote
 * original. A lógica de normalização de link e as validações (HTML/vazio) são
 * as mesmas do repositório de referência.
 */

/** Converte links comuns do Google Sheets / OneDrive em link de export .xlsx. */
export function normalizarLinkPlanilha(raw: string): string {
  const url = raw.trim();

  // Link "Publicar na web" (/spreadsheets/d/e/2PACX.../pub...):
  // já é um endpoint público, só garantimos output=xlsx.
  const publicado = url.match(/docs\.google\.com\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  if (publicado) {
    const base = `https://docs.google.com/spreadsheets/d/e/${publicado[1]}/pub`;
    const gid = url.match(/[#&?]gid=([0-9]+)/)?.[1];
    return `${base}?output=xlsx${gid ? `&gid=${gid}&single=true` : ""}`;
  }

  const google = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (google) {
    const id = google[1];
    const gid = url.match(/[#&?]gid=([0-9]+)/)?.[1];
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx${gid ? `&gid=${gid}` : ""}`;
  }
  return url;
}

/**
 * Baixa a planilha publicada na web e devolve o ArrayBuffer para o parser.
 * Feito no cliente (o endpoint /pub do Google libera CORS).
 */
export async function baixarPlanilhaRemota(rawUrl: string): Promise<{ buffer: ArrayBuffer; url: string }> {
  const url = normalizarLinkPlanilha(String(rawUrl ?? ""));
  // Aceita tanto uma URL http(s) (link colado pelo usuário) quanto um caminho
  // relativo da própria origem (ex.: /api/gestao/planilha, servido pelo backend).
  const isRelative = url.startsWith("/");
  if (!isRelative && !/^https?:\/\//i.test(url)) throw new Error("Informe um link http(s) válido.");

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Não foi possível baixar a planilha (HTTP ${res.status}). Verifique se o link está publicado/compartilhado publicamente.`
    );
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength === 0) throw new Error("O link retornou um arquivo vazio.");
  // HTML = página de login/permissão em vez do arquivo
  const head = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 200)).trim().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    throw new Error(
      "O link retornou uma página HTML em vez da planilha. Publique a planilha na web ou use um link de export .xlsx."
    );
  }
  return { buffer, url };
}
