/** Tipos de `post-render.js` — para o stub de desenvolvimento (ad-spy-dev-stub.ts), que é TS estrito. */

export function renderizarSlides(pedido: {
  post: unknown;
  marca: unknown;
  imagens: { logo?: string | null; logo_escuro?: string | null; fotos: (string | null)[] };
  indices?: number[];
  formato?: "jpeg" | "png";
  qualidade?: number;
  url?: string;
  log?: (m: string) => void;
}): Promise<{ indice: number; bytes: Buffer; avisos: { campo: string; tipo: string; detalhe: string }[] }[]>;
export function fecharRender(): Promise<void>;
