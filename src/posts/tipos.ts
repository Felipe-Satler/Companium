/**
 * O que um template recebe para desenhar UM slide.
 *
 * Contrato pensado para o Remotion, que é para onde estes componentes vão quando virarem reels: o
 * componente é função pura das props — sem fetch, sem efeito que busque dado, sem depender de
 * contexto do app (auth, tema, react-query). Tamanho em px vem por prop, e `progresso` (0 a 1) é o
 * que, num vídeo, virá do frame atual; no estático é sempre 1.
 */

import type { Paleta } from "../../shared/paleta";
import type { BrandKit } from "../../shared/brand-kit";
import type { PostRenderizavel } from "../../shared/post-templates";

/** O que da marca a arte usa. As imagens vêm à parte, já como URL (blob na tela, data URL no render). */
export type MarcaDaArte = {
  nome_clinica: string;
  paleta: { [K in keyof Paleta]: string | null };
  fontes: { titulo: string; texto: string };
  contatos: BrandKit["contatos"];
  enderecos: BrandKit["enderecos"];
};

export type ImagensDaArte = {
  logo?: string | null;
  logo_escuro?: string | null;
  /** As fotos da arte, na ordem do índice `foto` de cada slide. */
  fotos: string[];
};

export type PropsDoSlide = {
  post: PostRenderizavel;
  indice: number;
  marca: MarcaDaArte;
  imagens: ImagensDaArte;
  largura: number;
  altura: number;
  /** 0 a 1. Estático = 1. */
  progresso?: number;
};

/** O kit da tela vira a marca da arte: só o que desenha. */
export function marcaDoKit(kit: BrandKit): MarcaDaArte {
  return {
    nome_clinica: kit.nome_clinica,
    paleta: kit.paleta,
    fontes: kit.fontes,
    contatos: kit.contatos,
    enderecos: kit.enderecos,
  };
}
