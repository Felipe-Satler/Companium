import { ExternalLink, ImageOff, Play } from "lucide-react";
import { proxiedImg } from "@/lib/imagemProxy";
import type { MarketingSnapshot } from "@/utils/relatorioSnapshot";
import { CANAIS_CRIATIVO } from "../../../../shared/relatorio-canais";

/**
 * Carrossel horizontal dos criativos do período — a leitura visual do que esteve no ar.
 *
 * Convive com a TABELA abaixo e não a substitui: aqui se bate o olho no anúncio (imagem grande,
 * rolagem horizontal, clique no vídeo); lá se compara Hook/Hold e custo por resultado entre anúncios,
 * que é o que embasa a leitura do agente. São duas perguntas diferentes sobre o mesmo dado.
 *
 * Lê do `snapshot` GRAVADO, como o resto do relatório: um relatório de agosto aberto em dezembro
 * mostra os anúncios de agosto. As miniaturas são URLs duráveis (as imagens são re-hospedadas no
 * Supabase Storage), então guardar a URL não quebra o carrossel depois.
 *
 * Rolagem nativa com `snap`, não biblioteca: a lista é curta e um carrossel com setas, autoplay e dots
 * seria mais código do que o problema pede.
 */

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Criativo = MarketingSnapshot["criativos"][number];

function Card({ c }: { c: Criativo }) {
  const metricas = [
    Number.isFinite(c.gasto) ? BRL.format(c.gasto) : null,
    // "Resultado" é o tipo DOMINANTE do anúncio, não "lead": conta otimizada para mensagem não tem
    // cadastro, e chamar tudo de lead faria o número parecer zero.
    Number.isFinite(c.resultados) ? `${c.resultados} ${c.tipoResultado || "result."}` : null,
    c.cpl === null ? null : `a ${BRL.format(c.cpl)}`,
  ].filter(Boolean);

  const miolo = (
    <>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-t-lg bg-muted">
        {c.thumbnail ? (
          <img
            src={proxiedImg(c.thumbnail, 360, 450)}
            alt={c.codigo || "criativo"}
            loading="lazy"
            // object-contain: criativo cortado engana quem está julgando o anúncio.
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-5 w-5" />
          </div>
        )}
        {c.link && (
          <span className="absolute bottom-1 right-1 rounded bg-background/85 p-1 text-foreground">
            {c.formato === "video" ? <Play className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
          </span>
        )}
        {c.status === "pausado" && (
          <span className="absolute left-1 top-1 rounded bg-background/85 px-1 text-[10px] font-medium text-muted-foreground">
            pausado
          </span>
        )}
        {c.formato === "estatico" && (
          // Dito na tela pelo mesmo motivo que está na regra do agente: estático tem Hook/Hold perto
          // de zero por natureza, e sem esse rótulo parece anúncio ruim.
          <span className="absolute right-1 top-1 rounded bg-background/85 px-1 text-[10px] font-medium text-muted-foreground">
            estático
          </span>
        )}
      </div>
      <div className="space-y-0.5 p-2">
        <p className="line-clamp-2 text-[11px] font-medium leading-tight" title={c.codigo}>
          {c.codigo || "(sem código)"}
        </p>
        <p className="text-[10px] tabular-nums text-muted-foreground">{metricas.join(" · ") || "—"}</p>
      </div>
    </>
  );

  const classe = "w-[150px] shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-card";

  // Sem link não é link: âncora sem href não é focável nem anunciada, e um <a> morto sugere que o
  // clique faz algo. A imagem continua visível, só não é clicável.
  return c.link ? (
    <a
      href={c.link}
      target="_blank"
      rel="noopener noreferrer"
      className={`${classe} transition-shadow hover:shadow-md`}
      title={`Abrir "${c.codigo}"`}
    >
      {miolo}
    </a>
  ) : (
    <div className={classe}>{miolo}</div>
  );
}

export function RelatorioCriativos({ mkt }: { mkt: MarketingSnapshot }) {
  const itens = mkt?.criativos ?? [];
  const total = mkt?.totalAnuncios ?? itens.length;
  const semFonte = CANAIS_CRIATIVO.filter((c) => !c.disponivel);

  if (!itens.length) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {mkt?.disponivel === false
          ? "Não foi possível ler os criativos deste período — o que é diferente de não haver anúncio no ar."
          : "Nenhum anúncio de geração de demanda rodou no período."}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Criativos no ar
        </h4>
        <span className="text-[11px] text-muted-foreground">
          {total > itens.length
            ? `${itens.length} salientes de ${total}`
            : `${itens.length} anúncio${itens.length === 1 ? "" : "s"}`}
        </span>
        {/* Canal sem fonte aparece DITO, não omitido: sem isso alguém olha o carrossel e conclui que
            o cliente não roda Google — quando o que falta é o dado. */}
        {semFonte.map((c) => (
          <span
            key={c.id}
            className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            title={c.resumo}
          >
            {c.label}: em breve
          </span>
        ))}
      </div>

      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2">
        {itens.map((c) => (
          <Card key={`${c.adId}-${c.codigo}`} c={c} />
        ))}
      </div>
    </div>
  );
}
