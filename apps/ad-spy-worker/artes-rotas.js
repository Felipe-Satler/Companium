/**
 * Artes estáticas (Marketing › Oficina de Artes, 27/10/2026): do anúncio de uma composição SALVA
 * ao JPEG de cada página.
 *
 *   POST   /api/spy/artes/fotos?cliente=…     corpo = a foto (png|jpeg|webp) -> { caminho }
 *   POST   /api/spy/artes                     { compositionId, indice, opcoes } -> 202 { id }
 *   GET    /api/spy/artes?compositionId=…&indice=…   as artes de um anúncio (sem filtro: a carteira
 *                                         inteira, até 200 — as Artes Salvas da Oficina)
 *   GET    /api/spy/artes/:id                 uma arte  <- endpoint de polling
 *   PATCH  /api/spy/artes/:id                 { slides, legenda, hashtags, fundo? } -> ajuste à mão
 *   GET    /api/spy/artes/:id/fotos/:n        os bytes da foto n da arte
 *   POST   /api/spy/artes/:id/render          { indice, formato? } -> o arquivo do slide
 *   DELETE /api/spy/artes/:id                 só quem criou ou admin
 *
 * O fluxo: a pré-etapa da tela envia as fotos (uma rota por foto, antes de criar a arte), depois
 * cria a arte com as chaves de cada elemento. O worker grava a linha `running`, chama o `artagent`
 * (que destrincha o anúncio nas páginas), monta o post renderizável com as regras de identificação
 * e grava `pronta`. O render é sob demanda: a tela pede o arquivo de cada página.
 *
 * Num arquivo próprio pelo mesmo motivo de `brand-kit-rotas.js`.
 */

import { randomUUID } from "node:crypto";
import express from "express";
import { runAgentCli } from "./agent-cli.js";
import { requireInternalUser } from "./auth.js";
import { EXTENSAO, kitCompleto, tipoDaImagem } from "./brand-kit-rotas.js";
import { ARTE_AGENT_ID, ARTE_RUN_TIMEOUT_MS } from "./config.js";
import {
  FORMATOS_DE_ARTE,
  anunciosDaLinha,
  aplicarRegrasDoPost,
  buildArtePrompt,
  hashDoAnuncio,
  montarPost,
  normalizarOpcoes,
  parseArteReply,
  totalDeSlides,
} from "./arte-prompt.js";
import {
  dbEnabled,
  deleteArte,
  fecharArtesOrfas,
  getArte,
  getBrandKit,
  getComposition,
  insertArte,
  isAdmin,
  listArtes,
  patchArte,
  storageDownload,
  storageUpload,
} from "./db.js";
import { renderizarSlides } from "./post-render.js";
import { MAX_BYTES_IMAGEM, temIdentificacao } from "../../shared/brand-kit.js";
import {
  PROPORCOES,
  TEMPLATE_PADRAO,
  getTemplate,
  nomeDoArquivoDoSlide,
  normalizarSlides,
} from "../../shared/post-templates.js";
import { exigenciaDeIdentificacao, ondeIdentificar } from "../../shared/regras-identificacao.js";
import { normalizarFundo } from "../../shared/fundos.js";

/** Destrinchar é uma chamada de agente: duas ao mesmo tempo é o teto, como nos outros agentes. */
const MAX_ARTES_INFLIGHT = 2;
let emAndamento = 0;

class ErroDoPedido extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const semBanco = (res) =>
  res.status(503).json({ error: "Worker sem SUPABASE_SERVICE_KEY — não é possível criar artes." });

/**
 * A marca COPIADA para a arte: trocar a paleta do cliente depois não muda uma arte entregue. As
 * imagens vão por caminho; se o arquivo sumir (logo trocado), o render cai para o do kit atual.
 */
function marcaDaArte(kit) {
  return {
    nome_clinica: kit.nome_clinica,
    paleta: kit.paleta,
    fontes: kit.fontes,
    contatos: kit.contatos,
    enderecos: kit.enderecos,
    imagens: { logo: kit.imagens.logo, logo_escuro: kit.imagens.logo_escuro },
  };
}

function sessionId(arteId) {
  // Sessão nova por chamada, como no Composer: sessão viva reaproveitada faz o Gateway abortar.
  return `arte-${String(arteId).replace(/-/g, "").slice(0, 16)}-${Date.now().toString(36)}`;
}

/** Destrincha o anúncio e grava o post. Nunca lança: falha vira `error` na linha. */
async function destrinchar(arte, { anuncio, kit, log }) {
  emAndamento += 1;
  try {
    const template = getTemplate(arte.opcoes.template) || getTemplate(TEMPLATE_PADRAO);
    const { exigencia } = exigenciaDeIdentificacao({
      uso: arte.opcoes.uso,
      circulaFora: arte.opcoes.circula_fora,
      bioConferida: kit.bio_conferida,
    });
    const onde = ondeIdentificar(exigencia, arte.opcoes.onde_identificar);
    const content = buildArtePrompt({
      anuncio,
      template,
      cliente: arte.nome_exibicao || arte.cliente,
      uso: arte.opcoes.uso,
      circulaFora: arte.opcoes.circula_fora,
      elementos: arte.opcoes.elementos,
      fotos: arte.opcoes.fotos,
      identificacao: kit.identificacao,
      naLegenda: onde.naLegenda,
    });
    log(`[arte ${arte.id}] via ${ARTE_AGENT_ID} (${content.length} chars, ${totalDeSlides(anuncio)} página(s))`);
    const { finalText } = await runAgentCli({
      agentId: ARTE_AGENT_ID,
      content,
      sessionId: sessionId(arte.id),
      timeoutMs: ARTE_RUN_TIMEOUT_MS,
      log,
    });
    const lido = parseArteReply(finalText, { template, total: totalDeSlides(anuncio), fotos: arte.opcoes.fotos.length });
    if (lido.semJson) throw new Error("O agente respondeu sem o bloco de páginas da arte.");
    const { post, avisos } = montarPost({
      lido,
      anuncio,
      template,
      proporcao: arte.opcoes.proporcao,
      opcoes: arte.opcoes,
      kitIdentificacao: kit.identificacao,
      onde,
    });
    await patchArte(arte.id, { post, avisos, status: "pronta", error: null });
    log(`[arte ${arte.id}] pronta: ${post.slides.length} página(s), ${avisos.length} aviso(s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[arte ${arte.id}] FALHOU: ${msg}`);
    await patchArte(arte.id, { status: "error", error: msg.slice(0, 500) }).catch(() => {});
  } finally {
    emAndamento -= 1;
  }
}

/** Bytes do bucket como data URL — a página de render não tem token para pedir o bucket. */
async function comoDataUrl(caminho) {
  if (!caminho) return null;
  const bytes = await storageDownload(caminho).catch(() => null);
  if (!bytes) return null;
  return `data:${tipoDaImagem(bytes) || "image/png"};base64,${bytes.toString("base64")}`;
}

async function podeMexer(arte, userId) {
  return arte.criado_por === userId || (await isAdmin(userId).catch(() => false));
}

export function registrarRotasDasArtes(app, { wrap, log = () => {} }) {
  // Do boot anterior, ninguém mais fecha: a tela ficaria girando para sempre.
  if (dbEnabled()) {
    void fecharArtesOrfas("O worker reiniciou no meio da arte — gere de novo.").catch(() => {});
  }

  app.post(
    "/api/spy/artes/fotos",
    express.raw({ type: () => true, limit: MAX_BYTES_IMAGEM }),
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      if (!dbEnabled()) return semBanco(res);
      const cliente = String(req.query.cliente || "");
      if (!/^[a-z0-9_-]{1,80}$/i.test(cliente)) throw new ErroDoPedido("Cliente inválido.");
      const bytes = Buffer.isBuffer(req.body) ? req.body : null;
      const mime = tipoDaImagem(bytes);
      if (!mime) throw new ErroDoPedido("Envie uma foto PNG, JPEG ou WebP.");
      const caminho = `artes/${cliente}/fotos/${randomUUID()}.${EXTENSAO[mime]}`;
      await storageUpload(caminho, bytes, mime);
      log(`foto de arte de ${cliente} enviada por ${userId} (${bytes.length} bytes)`);
      res.json({ caminho });
    })
  );

  app.post(
    "/api/spy/artes",
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      if (!dbEnabled()) return semBanco(res);
      const compositionId = String(req.body?.compositionId || "");
      const indice = Number(req.body?.indice);
      if (!compositionId || !Number.isInteger(indice) || indice < 0) throw new ErroDoPedido("Anúncio inválido.");

      const composicao = await getComposition(compositionId);
      if (!composicao) throw new ErroDoPedido("Composição não encontrada.", 404);
      // Só composição SALVA: em revisão, o anúncio ainda pode mudar debaixo da arte.
      if (composicao.status !== "ok") {
        throw new ErroDoPedido("Só dá para criar o estático de uma composição salva.", 409);
      }
      const anuncio = anunciosDaLinha(composicao)[indice];
      if (!anuncio || anuncio.status !== "ok" || !anuncio.composicao) {
        throw new ErroDoPedido("Este anúncio não está pronto.", 409);
      }
      if (!FORMATOS_DE_ARTE.includes(anuncio.formato)) {
        throw new ErroDoPedido("Só anúncios de Feed do Instagram e de Meta Ads viram arte estática.", 409);
      }

      const kit = kitCompleto(composicao.cliente, await getBrandKit(composicao.cliente));
      // O CRM vai em toda passagem pelo agente (mesmo quando não entra na arte): sem ele no kit, não
      // há o que passar — e um CRM inventado numa peça publicada é o pior erro possível.
      if (!temIdentificacao(kit)) {
        throw new ErroDoPedido("Cadastre nome, CRM e UF do médico no Brand kit do cliente antes de criar a arte.", 409);
      }
      const { opcoes, erros } = normalizarOpcoes(req.body?.opcoes, {
        kit,
        cliente: composicao.cliente,
        formato: anuncio.formato,
      });
      if (erros.length) throw new ErroDoPedido(erros.join(" "));
      const { exigencia } = exigenciaDeIdentificacao({
        uso: opcoes.uso,
        circulaFora: opcoes.circula_fora,
        bioConferida: kit.bio_conferida,
      });
      const onde = ondeIdentificar(exigencia, opcoes.onde_identificar);
      if (onde.erro) throw new ErroDoPedido(onde.erro);
      if (emAndamento >= MAX_ARTES_INFLIGHT) {
        return res.status(503).json({ error: "Já há artes sendo geradas. Tente em instantes." });
      }

      const template = getTemplate(TEMPLATE_PADRAO);
      const arte = await insertArte({
        composition_id: composicao.id,
        anuncio_indice: indice,
        cliente: composicao.cliente,
        nome_exibicao: composicao.nome_exibicao || null,
        formato_origem: anuncio.formato,
        anuncio_hash: hashDoAnuncio(anuncio),
        opcoes: { ...opcoes, template: template.id, proporcao: "4:5" },
        marca: marcaDaArte(kit),
        status: "running",
        criado_por: userId,
        agent_id: ARTE_AGENT_ID,
      });
      void destrinchar(arte, { anuncio, kit, log });
      log(`arte ${arte.id} (${composicao.cliente}, anúncio ${indice + 1}) por ${userId}`);
      res.status(202).json({ id: arte.id, status: arte.status });
    })
  );

  app.get(
    "/api/spy/artes",
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      const compositionId = req.query.compositionId ? String(req.query.compositionId) : null;
      const indice = req.query.indice != null && req.query.indice !== "" ? Number(req.query.indice) : null;
      const cliente = req.query.cliente ? String(req.query.cliente) : null;
      // Sem composição é a aba "Artes Salvas" da Oficina, que mostra a carteira inteira: o teto sobe,
      // como nas Composições Salvas.
      const rows = await listArtes({
        compositionId,
        indice: Number.isInteger(indice) ? indice : null,
        cliente,
        limit: compositionId ? 50 : 200,
      });
      const admin = await isAdmin(userId).catch(() => false);
      res.json({ artes: rows.map((a) => ({ ...a, canDelete: admin || a.criado_por === userId })) });
    })
  );

  app.get(
    "/api/spy/artes/:id",
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      const arte = await getArte(req.params.id);
      if (!arte) return res.status(404).json({ error: "Arte não encontrada." });
      // Desatualizada: o anúncio de origem mudou depois da arte (a composição foi reaberta e editada).
      const composicao = arte.composition_id ? await getComposition(arte.composition_id).catch(() => null) : null;
      const origem = composicao ? anunciosDaLinha(composicao)[arte.anuncio_indice] : null;
      const desatualizada = Boolean(origem && hashDoAnuncio(origem) !== arte.anuncio_hash);
      res.json({ arte: { ...arte, desatualizada, canDelete: await podeMexer(arte, userId) } });
    })
  );

  app.patch(
    "/api/spy/artes/:id",
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      const arte = await getArte(req.params.id);
      if (!arte) return res.status(404).json({ error: "Arte não encontrada." });
      if (arte.status !== "pronta" || !arte.post) throw new ErroDoPedido("Esta arte não está pronta para ajuste.", 409);
      const template = getTemplate(arte.post.template?.id) || getTemplate(TEMPLATE_PADRAO);
      const fotos = Array.isArray(arte.opcoes?.fotos) ? arte.opcoes.fotos.length : 0;
      const slides = Array.isArray(req.body?.slides) ? req.body.slides : arte.post.slides;
      if (slides.length !== arte.post.slides.length) {
        throw new ErroDoPedido("O número de páginas não muda no ajuste: gere outra arte para isso.");
      }
      const editado = {
        ...arte.post,
        slides: normalizarSlides(slides, template, { fotos }),
        legenda: typeof req.body?.legenda === "string" ? req.body.legenda.slice(0, 2200) : arte.post.legenda,
        hashtags: Array.isArray(req.body?.hashtags)
          ? req.body.hashtags.map((h) => String(h).replace(/^#*/, "").trim()).filter(Boolean).slice(0, 10)
          : arte.post.hashtags,
        // `fundo` ausente no corpo = não mexe; null = volta ao liso. É uma receita (estilo + semente),
        // não uma imagem: o template a desenha no preview e no render.
        fundo: "fundo" in (req.body || {}) ? normalizarFundo(req.body.fundo) : arte.post.fundo ?? null,
      };
      // A identificação continua a do kit copiado na criação; as regras correm de novo sobre o texto
      // editado (citar a pós num ajuste tem de pôr o "NÃO ESPECIALISTA").
      const kit = kitCompleto(arte.cliente, await getBrandKit(arte.cliente));
      const id = { ...kit.identificacao, ...pick(arte.post.identificacao, ["nome", "crm", "uf", "rqe"]) };
      const { post, avisos } = aplicarRegrasDoPost(editado, template, id);
      await patchArte(arte.id, { post, avisos });
      log(`arte ${arte.id} ajustada por ${userId}`);
      res.json({ post, avisos });
    })
  );

  app.get(
    "/api/spy/artes/:id/fotos/:n",
    wrap(async (req, res) => {
      await requireInternalUser(req);
      const arte = await getArte(req.params.id);
      const foto = arte?.opcoes?.fotos?.[Number(req.params.n)];
      const bytes = foto?.caminho ? await storageDownload(foto.caminho) : null;
      if (!bytes) return res.status(404).json({ error: "Foto não encontrada." });
      res.setHeader("Content-Type", tipoDaImagem(bytes) || "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(bytes);
    })
  );

  app.post(
    "/api/spy/artes/:id/render",
    wrap(async (req, res) => {
      await requireInternalUser(req);
      const arte = await getArte(req.params.id);
      if (!arte) return res.status(404).json({ error: "Arte não encontrada." });
      if (arte.status !== "pronta" || !arte.post) throw new ErroDoPedido("Esta arte não está pronta.", 409);
      const indice = Number(req.body?.indice ?? 0);
      if (!Number.isInteger(indice) || indice < 0 || indice >= arte.post.slides.length) {
        throw new ErroDoPedido("Página inválida.");
      }
      const formato = req.body?.formato === "png" ? "png" : "jpeg";

      // Logo: o da cópia da marca; se o arquivo tiver sumido (logo trocado no kit), o do kit atual.
      const kitAtual = kitCompleto(arte.cliente, await getBrandKit(arte.cliente).catch(() => null));
      const imagem = async (tipo) =>
        (await comoDataUrl(arte.marca?.imagens?.[tipo])) || (await comoDataUrl(kitAtual.imagens[tipo]));
      const imagens = {
        logo: await imagem("logo"),
        logo_escuro: await imagem("logo_escuro"),
        // Só a foto que ESTE slide usa: as outras seriam megabytes a mais para o Chrome por nada.
        fotos: await Promise.all(
          (arte.opcoes?.fotos || []).map((f, n) => (arte.post.slides[indice].foto === n ? comoDataUrl(f.caminho) : null))
        ),
      };
      const [slide] = await renderizarSlides({
        post: arte.post,
        marca: arte.marca,
        imagens,
        indices: [indice],
        formato,
        log,
      });
      const base = `${arte.nome_exibicao || arte.cliente}-${PROPORCOES[arte.post.proporcao] ? arte.post.proporcao.replace(":", "x") : "4x5"}`;
      const nome = nomeDoArquivoDoSlide(base, indice, formato === "png" ? "png" : "jpg");
      res.setHeader("Content-Type", formato === "png" ? "image/png" : "image/jpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
      // Os avisos do render (texto que não coube, fonte ausente) vão no cabeçalho: o corpo é a imagem.
      res.setHeader("X-Avisos-Render", encodeURIComponent(JSON.stringify(slide.avisos || [])));
      res.end(slide.bytes);
    })
  );

  app.delete(
    "/api/spy/artes/:id",
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      const arte = await getArte(req.params.id);
      if (!arte) return res.status(404).json({ error: "Arte não encontrada." });
      if (!(await podeMexer(arte, userId))) {
        return res.status(403).json({ error: "Só quem criou a arte ou um administrador pode apagá-la." });
      }
      // As fotos ficam no bucket: outra arte do mesmo pedido pode estar usando a mesma.
      await deleteArte(arte.id);
      res.json({ ok: true });
    })
  );
}

function pick(obj, chaves) {
  const o = obj || {};
  return Object.fromEntries(chaves.filter((k) => o[k] != null && o[k] !== "").map((k) => [k, o[k]]));
}
