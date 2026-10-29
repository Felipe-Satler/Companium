import { useState } from "react";
import {
  Bookmark,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Globe,
  Heart,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";
import type { Arte } from "@/lib/artesApi";
import { PreviewDoSlide } from "@/posts/SlideDaArte";
import type { ImagensDaArte } from "@/posts/tipos";
import {
  CORTE_FACEBOOK_ORGANICO,
  CORTE_FACEBOOK_PAGO,
  CORTE_INSTAGRAM,
  cortarLegenda,
  legendaComHashtags,
} from "./legenda";

/**
 * Como a arte fica no feed do Instagram, do Facebook e numa conversa do WhatsApp.
 *
 * São APROXIMAÇÕES desenhadas aqui, com ícones genéricos — não cópias das interfaces. Servem para
 * conferir o que importa antes de postar: o que se lê antes do "mais", o peso da arte no meio do
 * feed, como o carrossel vira álbum no WhatsApp. As cores são as claras de cada app, fixas: o
 * mockup não segue o tema do Companium, porque o post não vai aparecer no tema do Companium.
 *
 * O slide dentro do mockup é o MESMO componente do arquivo final (`PreviewDoSlide`).
 */

export const LARGURA_MOCKUP = 360;

type Props = { arte: Arte; imagens: ImagensDaArte };

function nomeDaConta(arte: Arte) {
  return arte.marca.nome_clinica || arte.nome_exibicao || arte.cliente;
}

function Avatar({ imagens, nome }: { imagens: ImagensDaArte; nome: string }) {
  return imagens.logo ? (
    <img src={imagens.logo} alt="" className="h-8 w-8 rounded-full border border-neutral-200 bg-white object-contain p-0.5" />
  ) : (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700">
      {nome.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** O carrossel do post: setas e pontos, como no feed. Post único é só a imagem. */
function Carrossel({ arte, imagens, largura }: Props & { largura: number }) {
  const [atual, setAtual] = useState(0);
  const post = arte.post!;
  const total = post.slides.length;
  return (
    <div className="relative">
      <PreviewDoSlide post={post} indice={atual} marca={arte.marca} imagens={imagens} largura={largura} />
      {total > 1 && (
        <>
          {atual > 0 && (
            <button
              type="button"
              onClick={() => setAtual((a) => a - 1)}
              className="absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-800 shadow"
              aria-label="Página anterior do carrossel"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {atual < total - 1 && (
            <button
              type="button"
              onClick={() => setAtual((a) => a + 1)}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-800 shadow"
              aria-label="Próxima página do carrossel"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
            {atual + 1}/{total}
          </span>
          <div className="absolute -bottom-4 left-0 right-0 flex justify-center gap-1" aria-hidden>
            {post.slides.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === atual ? "bg-sky-500" : "bg-neutral-300"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A legenda com o "mais" que abre o resto, como no app. */
function Legenda({ texto, limite, prefixo }: { texto: string; limite: number; prefixo?: string }) {
  const [aberta, setAberta] = useState(false);
  const { visivel, cortada } = cortarLegenda(texto, limite);
  return (
    <p className="whitespace-pre-line text-[13px] leading-snug text-neutral-900">
      {prefixo && <span className="mr-1 font-semibold">{prefixo}</span>}
      {aberta || !cortada ? texto : visivel}
      {cortada && !aberta && (
        <button type="button" onClick={() => setAberta(true)} className="ml-1 text-neutral-500">
          … mais
        </button>
      )}
    </p>
  );
}

function Moldura({ children, fundo = "bg-white" }: { children: React.ReactNode; fundo?: string }) {
  return (
    <div
      className={`mx-auto overflow-hidden rounded-[28px] border-[6px] border-neutral-800 shadow-xl ${fundo}`}
      style={{ width: LARGURA_MOCKUP + 12 }}
    >
      {children}
    </div>
  );
}

export function MockupInstagram({ arte, imagens }: Props) {
  const post = arte.post!;
  const pago = post.uso === "pago";
  const handle = arte.marca.contatos.instagram || nomeDaConta(arte).toLowerCase().replace(/\s+/g, "");
  const legenda = legendaComHashtags(post.legenda, post.hashtags);
  return (
    <Moldura>
      <div className="flex items-center gap-2 px-3 py-2">
        <Avatar imagens={imagens} nome={handle} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-neutral-900">{handle}</p>
          {pago && <p className="text-[11px] text-neutral-500">Patrocinado</p>}
        </div>
        <MoreHorizontal className="h-4 w-4 text-neutral-700" />
      </div>
      <Carrossel arte={arte} imagens={imagens} largura={LARGURA_MOCKUP} />
      {pago && (
        <div className="mt-0 flex items-center justify-between bg-neutral-100 px-3 py-2 text-[13px] font-semibold text-neutral-900">
          Saiba mais <ChevronRight className="h-4 w-4" />
        </div>
      )}
      <div className="flex items-center gap-3.5 px-3 pb-1 pt-5 text-neutral-900">
        <Heart className="h-5 w-5" />
        <MessageCircle className="h-5 w-5" />
        <Send className="h-5 w-5" />
        <Bookmark className="ml-auto h-5 w-5" />
      </div>
      <div className="space-y-1 px-3 pb-4">
        <p className="text-[13px] font-semibold text-neutral-900">Curtido por pacientes e outras pessoas</p>
        <Legenda texto={legenda} limite={CORTE_INSTAGRAM} prefixo={handle} />
      </div>
    </Moldura>
  );
}

export function MockupFacebook({ arte, imagens }: Props) {
  const post = arte.post!;
  const pago = post.uso === "pago";
  const nome = nomeDaConta(arte);
  return (
    <Moldura fundo="bg-neutral-100">
      <div className="bg-white">
        <div className="flex items-center gap-2 px-3 py-2">
          <Avatar imagens={imagens} nome={nome} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold text-neutral-900">{nome}</p>
            <p className="flex items-center gap-1 text-[11px] text-neutral-500">
              {pago ? "Patrocinado" : "Agora"} · <Globe className="h-3 w-3" />
            </p>
          </div>
          <MoreHorizontal className="h-4 w-4 text-neutral-600" />
        </div>
        <div className="px-3 pb-2">
          <Legenda texto={legendaComHashtags(post.legenda, post.hashtags)} limite={pago ? CORTE_FACEBOOK_PAGO : CORTE_FACEBOOK_ORGANICO} />
        </div>
        <Carrossel arte={arte} imagens={imagens} largura={LARGURA_MOCKUP} />
        <div className="mt-5 flex items-center justify-around border-t border-neutral-200 py-2 text-[12px] font-medium text-neutral-600">
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-4 w-4" /> Curtir
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" /> Comentar
          </span>
          <span className="flex items-center gap-1">
            <Share2 className="h-4 w-4" /> Compartilhar
          </span>
        </div>
      </div>
    </Moldura>
  );
}

/**
 * No WhatsApp, várias imagens chegam como ÁLBUM: uma grade de até quatro, com "+N" na última. Uma
 * imagem só chega inteira, com a legenda embaixo.
 */
export function MockupWhatsApp({ arte, imagens }: Props) {
  const post = arte.post!;
  const total = post.slides.length;
  const larguraBalao = LARGURA_MOCKUP - 72;
  const legenda = legendaComHashtags(post.legenda, post.hashtags);
  const meia = Math.floor((larguraBalao - 6) / 2);
  return (
    <Moldura fundo="bg-[#ECE5DD]">
      <div className="bg-[#075E54] px-3 py-2.5 text-[13px] font-semibold text-white">Conversa</div>
      <div className="flex justify-end px-3 py-4">
        <div className="rounded-lg rounded-tr-none bg-[#DCF8C6] p-1 shadow-sm" style={{ width: larguraBalao + 8 }}>
          {total === 1 ? (
            <div className="overflow-hidden rounded-md">
              <PreviewDoSlide post={post} indice={0} marca={arte.marca} imagens={imagens} largura={larguraBalao} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {post.slides.slice(0, 4).map((_, i) => (
                <div key={i} className="relative overflow-hidden rounded-md">
                  <PreviewDoSlide post={post} indice={i} marca={arte.marca} imagens={imagens} largura={meia} />
                  {i === 3 && total > 4 && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xl font-semibold text-white">
                      +{total - 4}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="whitespace-pre-line px-1.5 pt-1.5 text-[13px] leading-snug text-neutral-900">{legenda}</p>
          <p className="flex items-center justify-end gap-1 px-1.5 pb-0.5 text-[10px] text-neutral-500">
            12:00 <CheckCheck className="h-3.5 w-3.5 text-sky-500" />
          </p>
        </div>
      </div>
    </Moldura>
  );
}
