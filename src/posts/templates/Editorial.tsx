import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { textoSobre } from "../../../shared/paleta";
import { carregarFonte } from "../fontes";
import { FundoAbstrato } from "../FundoAbstrato";
import { useAjusteDeTexto } from "../useAjusteDeTexto";
import type { MarcaDaArte, PropsDoSlide } from "../tipos";

/**
 * Template "Editorial" (v1.1.0) — 4:5, 1080×1350.
 *
 *   - `unico` e `capa`: fundo na cor PRIMÁRIA, título grande. Com foto, ela ocupa o alto da arte e o
 *     texto fica no painel de baixo.
 *   - `conteudo`: fundo CLARO (terciária), título na primária, numeração da página.
 *   - `cta`: fundo primária, chamada num botão na SECUNDÁRIA e os contatos que a pré-etapa incluiu.
 *   - Com `post.fundo` (1.1.0), um fundo abstrato em SVG por baixo de tudo (`FundoAbstrato`).
 *
 * Só estilo inline, sem Tailwind e sem nada do app: a página de render carrega este componente
 * sozinho, e o Remotion vai carregá-lo do mesmo jeito. As medidas são px do canvas de 1080 de
 * largura; o preview da tela encolhe o canvas inteiro com `transform`, nunca as medidas.
 *
 * Quem muda o desenho de um jeito que altera arte já gerada sobe a `versao` em
 * `shared/post-templates.js`: é ela que fica gravada junto da arte.
 */

const MARGEM = 84;

/** Cores com reserva: um kit sem paleta ainda dá uma arte legível, não uma tela branca. */
function cores(marca: MarcaDaArte) {
  const escuro = marca.paleta.primaria || "#1F2A44";
  const claro = marca.paleta.terciaria || "#F6F4EF";
  const acento = marca.paleta.secundaria || "#C8A24A";
  return { escuro, claro, acento, sobreEscuro: textoSobre(escuro), sobreClaro: textoSobre(claro), sobreAcento: textoSobre(acento) };
}

const familia = (nome: string) => `"${nome}", "Inter", system-ui, sans-serif`;

/** Espera as duas famílias da marca: medir o texto antes da fonte chegar mede a fonte errada. */
function useFontesProntas(fontes: MarcaDaArte["fontes"]) {
  const [prontas, setProntas] = useState(false);
  useEffect(() => {
    let vivo = true;
    setProntas(false);
    Promise.all([carregarFonte(fontes.titulo), carregarFonte(fontes.texto)]).then(() => vivo && setProntas(true));
    return () => {
      vivo = false;
    };
  }, [fontes.titulo, fontes.texto]);
  return prontas;
}

function TextoAjustado({
  children,
  min,
  max,
  alturaMax,
  estilo,
  deps,
  campo,
  preencher = false,
}: {
  children: ReactNode;
  min: number;
  max: number;
  /** Ignorado com `preencher`. */
  alturaMax: number;
  estilo: CSSProperties;
  deps: unknown[];
  campo: string;
  /** Ocupa o espaço que sobrar na coluna e se ajusta a ele, com o texto encostado embaixo. */
  preencher?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAjusteDeTexto(ref, { min, max, alturaMax: preencher ? "pai" : alturaMax }, deps);
  const texto = (
    <div ref={ref} data-campo={campo} style={{ width: "100%", overflowWrap: "break-word", textWrap: "balance", ...estilo } as CSSProperties}>
      {children}
    </div>
  );
  if (!preencher) return texto;
  return (
    <div style={{ flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>{texto}</div>
  );
}

/** Os contatos que a pré-etapa incluiu, na ordem em que uma pessoa procura. */
function contatosIncluidos(marca: MarcaDaArte, elementos: Record<string, boolean | undefined>) {
  const c = marca.contatos;
  const itens: { rotulo: string; valor: string }[] = [];
  if (elementos.whatsapp && c.whatsapp) itens.push({ rotulo: "WhatsApp", valor: c.whatsapp });
  if (elementos.telefone && c.telefone) itens.push({ rotulo: "Telefone", valor: c.telefone });
  if (elementos.instagram && c.instagram) itens.push({ rotulo: "Instagram", valor: `@${c.instagram}` });
  if (elementos.site && c.site) itens.push({ rotulo: "Site", valor: c.site });
  if (elementos.email && c.email) itens.push({ rotulo: "E-mail", valor: c.email });
  if (elementos.endereco) {
    for (const e of marca.enderecos.slice(0, 2)) {
      itens.push({ rotulo: e.rotulo || "Endereço", valor: e.linha });
    }
  }
  return itens;
}

function Marca({
  marca,
  imagens,
  elementos,
  fundoEscuro,
  altura,
  cor,
}: {
  marca: MarcaDaArte;
  imagens: PropsDoSlide["imagens"];
  elementos: Record<string, boolean | undefined>;
  fundoEscuro: boolean;
  altura: number;
  cor: string;
}) {
  const logo = elementos.logo ? (fundoEscuro ? imagens.logo_escuro || imagens.logo : imagens.logo) : null;
  if (logo) {
    return <img src={logo} alt="" data-imagem="logo" style={{ height: altura, maxWidth: 380, objectFit: "contain", objectPosition: "left center" }} />;
  }
  if (elementos.nome_clinica && marca.nome_clinica) {
    return (
      <div style={{ fontFamily: familia(marca.fontes.titulo), fontWeight: 700, fontSize: altura * 0.42, color: cor, letterSpacing: 0.5 }}>
        {marca.nome_clinica}
      </div>
    );
  }
  return null;
}

function Identificacao({ linha, cor, fonte }: { linha: string; cor: string; fonte: string }) {
  return (
    <div data-campo="identificacao" style={{ fontFamily: familia(fonte), fontSize: 22, fontWeight: 400, color: cor, opacity: 0.85, letterSpacing: 0.3 }}>
      {linha}
    </div>
  );
}

export function SlideEditorial({ post, indice, marca, imagens, largura, altura }: PropsDoSlide) {
  const slide = post.slides[indice];
  const prontas = useFontesProntas(marca.fontes);
  const c = cores(marca);
  const elementos = post.elementos as Record<string, boolean | undefined>;
  const foto = slide.foto != null ? imagens.fotos[slide.foto] ?? null : null;
  const identificacao = post.identificacao.naArte && post.identificacao.linha ? post.identificacao.linha : "";
  const total = post.slides.length;

  const base: CSSProperties = {
    width: largura,
    height: altura,
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    // Contexto de empilhamento: o fundo abstrato (z-index -1) pinta entre a cor do slide e o conteúdo.
    isolation: "isolate",
  };
  const fundo = (cor: string) => (
    <FundoAbstrato fundo={post.fundo} base={cor} acento={c.acento} largura={largura} altura={altura} indice={indice} />
  );

  if (slide.papel === "conteudo") {
    const alturaFoto = foto ? Math.round(altura * 0.36) : 0;
    return (
      <div data-slide={indice} style={{ ...base, background: c.claro, color: c.sobreClaro, padding: MARGEM }}>
        {fundo(c.claro)}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 72 }}>
          <div style={{ fontFamily: familia(marca.fontes.titulo), fontWeight: 700, fontSize: 28, color: c.escuro, letterSpacing: 2 }}>
            {String(indice + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </div>
          <Marca marca={marca} imagens={imagens} elementos={elementos} fundoEscuro={false} altura={60} cor={c.escuro} />
        </div>
        {foto && (
          <img
            src={foto}
            alt=""
            data-imagem="foto"
            style={{ marginTop: 40, width: "100%", height: alturaFoto, objectFit: "cover", borderRadius: 28 }}
          />
        )}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: foto ? 28 : 36, minHeight: 0, paddingTop: foto ? 36 : 0, paddingBottom: 24 }}
        >
          <div style={{ width: 96, height: 8, background: c.acento, borderRadius: 4, flexShrink: 0 }} />
          <TextoAjustado
            campo="titulo"
            min={44}
            max={92}
            alturaMax={360}
            preencher={Boolean(foto)}
            deps={[slide.titulo, marca.fontes.titulo, prontas, foto]}
            estilo={{ fontFamily: familia(marca.fontes.titulo), fontWeight: 700, lineHeight: 1.08, color: c.escuro }}
          >
            {slide.titulo}
          </TextoAjustado>
          {slide.apoio && (
            <TextoAjustado
              campo="apoio"
              min={26}
              max={42}
              alturaMax={foto ? 200 : 420}
              deps={[slide.apoio, marca.fontes.texto, prontas, foto]}
              estilo={{ fontFamily: familia(marca.fontes.texto), fontWeight: 400, lineHeight: 1.4, color: c.sobreClaro }}
            >
              {slide.apoio}
            </TextoAjustado>
          )}
        </div>
        {identificacao && <Identificacao linha={identificacao} cor={c.sobreClaro} fonte={marca.fontes.texto} />}
      </div>
    );
  }

  if (slide.papel === "cta") {
    const contatos = contatosIncluidos(marca, elementos);
    return (
      <div data-slide={indice} style={{ ...base, background: c.escuro, color: c.sobreEscuro, padding: MARGEM }}>
        {fundo(c.escuro)}
        <Marca marca={marca} imagens={imagens} elementos={elementos} fundoEscuro altura={84} cor={c.sobreEscuro} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 36, minHeight: 0 }}>
          <TextoAjustado
            campo="titulo"
            min={48}
            max={96}
            alturaMax={340}
            deps={[slide.titulo, marca.fontes.titulo, prontas]}
            estilo={{ fontFamily: familia(marca.fontes.titulo), fontWeight: 700, lineHeight: 1.08 }}
          >
            {slide.titulo}
          </TextoAjustado>
          {slide.apoio && (
            <TextoAjustado
              campo="apoio"
              min={26}
              max={40}
              alturaMax={200}
              deps={[slide.apoio, marca.fontes.texto, prontas]}
              estilo={{ fontFamily: familia(marca.fontes.texto), fontWeight: 400, lineHeight: 1.4, opacity: 0.92 }}
            >
              {slide.apoio}
            </TextoAjustado>
          )}
          {slide.cta && (
            <div
              data-campo="cta"
              style={{
                alignSelf: "flex-start",
                background: c.acento,
                color: c.sobreAcento,
                fontFamily: familia(marca.fontes.titulo),
                fontWeight: 700,
                fontSize: 38,
                padding: "26px 48px",
                borderRadius: 999,
                maxWidth: "100%",
              }}
            >
              {slide.cta}
            </div>
          )}
          {contatos.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
              {contatos.map((item) => (
                <div key={`${item.rotulo}-${item.valor}`} style={{ fontFamily: familia(marca.fontes.texto), fontSize: 30 }}>
                  <span style={{ opacity: 0.7 }}>{item.rotulo}: </span>
                  <span style={{ fontWeight: 700 }}>{item.valor}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {identificacao && <Identificacao linha={identificacao} cor={c.sobreEscuro} fonte={marca.fontes.texto} />}
      </div>
    );
  }

  // `unico` e `capa`
  const unico = slide.papel === "unico";
  const alturaFoto = foto ? Math.round(altura * 0.44) : 0;
  const contatos = unico ? contatosIncluidos(marca, elementos) : [];
  return (
    <div data-slide={indice} style={{ ...base, background: c.escuro, color: c.sobreEscuro }}>
      {fundo(c.escuro)}
      {foto && <img src={foto} alt="" data-imagem="foto" style={{ width: "100%", height: alturaFoto, objectFit: "cover", flexShrink: 0 }} />}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: MARGEM, paddingTop: foto ? 56 : MARGEM }}>
        <Marca marca={marca} imagens={imagens} elementos={elementos} fundoEscuro altura={foto ? 64 : 84} cor={c.sobreEscuro} />
        <div
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: foto ? 24 : 30, paddingTop: foto ? 28 : 0, paddingBottom: 24 }}
        >
          {slide.destaque && (
            <div
              data-campo="destaque"
              style={{
                alignSelf: "flex-start",
                background: c.acento,
                color: c.sobreAcento,
                fontFamily: familia(marca.fontes.texto),
                fontWeight: 700,
                fontSize: 26,
                letterSpacing: 2,
                textTransform: "uppercase",
                padding: "10px 22px",
                borderRadius: 999,
                flexShrink: 0,
              }}
            >
              {slide.destaque}
            </div>
          )}
          <TextoAjustado
            campo="titulo"
            min={foto ? 40 : 56}
            max={foto ? 84 : 118}
            alturaMax={520}
            preencher={Boolean(foto)}
            deps={[slide.titulo, marca.fontes.titulo, prontas, foto]}
            estilo={{ fontFamily: familia(marca.fontes.titulo), fontWeight: 700, lineHeight: 1.05 }}
          >
            {slide.titulo}
          </TextoAjustado>
          {slide.apoio && (
            <TextoAjustado
              campo="apoio"
              min={24}
              max={foto ? 34 : 40}
              alturaMax={foto ? 100 : 220}
              deps={[slide.apoio, marca.fontes.texto, prontas, foto]}
              estilo={{ fontFamily: familia(marca.fontes.texto), fontWeight: 400, lineHeight: 1.38, opacity: 0.92 }}
            >
              {slide.apoio}
            </TextoAjustado>
          )}
          {unico && slide.cta && (
            <div
              data-campo="cta"
              style={{
                alignSelf: "flex-start",
                background: c.acento,
                color: c.sobreAcento,
                fontFamily: familia(marca.fontes.titulo),
                fontWeight: 700,
                fontSize: 32,
                padding: "20px 40px",
                borderRadius: 999,
                flexShrink: 0,
              }}
            >
              {slide.cta}
            </div>
          )}
          {!unico && (
            <div style={{ fontFamily: familia(marca.fontes.texto), fontSize: 26, opacity: 0.75, letterSpacing: 1 }}>
              arraste para o lado →
            </div>
          )}
        </div>
        {contatos.length > 0 && (
          <div style={{ fontFamily: familia(marca.fontes.texto), fontSize: 24, lineHeight: 1.35, opacity: 0.85, marginBottom: identificacao ? 10 : 0, flexShrink: 0 }}>
            {contatos.map((i) => i.valor).join("  ·  ")}
          </div>
        )}
        {identificacao && <Identificacao linha={identificacao} cor={c.sobreEscuro} fonte={marca.fontes.texto} />}
      </div>
    </div>
  );
}
