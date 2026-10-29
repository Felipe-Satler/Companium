/**
 * Rotas do Brand kit (Central de Clientes › Brand kit, 27/10/2026).
 *
 *   GET    /api/spy/clientes/:cliente/brand-kit                 o kit (vazio se não houver) + a
 *                                                               identificação do Estudo de Copy
 *   PUT    /api/spy/clientes/:cliente/brand-kit                 { kit } -> grava (menos as imagens)
 *   GET    /api/spy/clientes/:cliente/brand-kit/imagens/:tipo   os bytes da imagem
 *   PUT    /api/spy/clientes/:cliente/brand-kit/imagens/:tipo   corpo = a imagem (png|jpeg|webp)
 *   DELETE /api/spy/clientes/:cliente/brand-kit/imagens/:tipo   tira a imagem do kit
 *
 * Num arquivo próprio, e não no `index.js`: ele tem 2.700 linhas e outras frentes editando, e estas
 * rotas não dividem nada com as de lá além do `wrap` e da auth. `index.js` só as registra.
 *
 * Toda rota é de usuário interno (`requireInternalUser`), como o resto do worker. Qualquer pessoa da
 * equipe edita o kit de qualquer cliente — é o mesmo acesso da Central de Clientes.
 */

import express from "express";
import { requireInternalUser } from "./auth.js";
import { clientesAtivos } from "./briefs.js";
import {
  dbEnabled,
  getBrandKit,
  getIdentificacaoDoEstudo,
  patchBrandKitImagens,
  readProjetosLista,
  storageDownload,
  storageRemove,
  storageUpload,
  upsertBrandKit,
} from "./db.js";
import {
  IMAGEM_IDS,
  MAX_BYTES_IMAGEM,
  kitVazio,
  normalizarBrandKit,
} from "../../shared/brand-kit.js";

class ErroDoPedido extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.status = 400;
    Object.assign(this, extra);
  }
}

/**
 * O tipo da imagem pelos BYTES, não pelo Content-Type: o cabeçalho é o que o navegador diz, e um
 * arquivo renomeado para .png passaria. SVG não entra (é script em potencial, e o render o abriria).
 */
export function tipoDaImagem(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export const EXTENSAO = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * O kit lido do banco, sempre com a forma inteira: linha que não existe vira o kit vazio, e coluna
 * `{}` de uma linha criada só pelo upload de uma imagem ganha os campos que faltam.
 */
export function kitCompleto(cliente, linha) {
  const vazio = kitVazio(cliente);
  if (!linha) return vazio;
  return {
    ...vazio,
    nome_clinica: linha.nome_clinica || "",
    paleta: { ...vazio.paleta, ...(linha.paleta || {}) },
    fontes: { ...vazio.fontes, ...(linha.fontes || {}) },
    contatos: { ...vazio.contatos, ...(linha.contatos || {}) },
    enderecos: Array.isArray(linha.enderecos) ? linha.enderecos : [],
    identificacao: { ...vazio.identificacao, ...(linha.identificacao || {}) },
    bio_conferida: linha.bio_conferida === true,
    imagens: { ...vazio.imagens, ...(linha.imagens || {}) },
  };
}

/** O cliente da URL, conferido contra a carteira ativa: é ele que vira pasta no bucket. */
async function clienteDaCarteira(req) {
  const cliente = String(req.params.cliente || "");
  if (!clientesAtivos(await readProjetosLista()).some((c) => c.padrao === cliente)) {
    const err = new Error("Cliente não encontrado na carteira ativa.");
    err.status = 404;
    throw err;
  }
  return cliente;
}

function tipoDaRota(req) {
  const tipo = String(req.params.tipo || "");
  if (!IMAGEM_IDS.includes(tipo)) throw new ErroDoPedido("Tipo de imagem desconhecido.");
  return tipo;
}

const semBanco = (res) =>
  res.status(503).json({ error: "Worker sem SUPABASE_SERVICE_KEY — o Brand kit não pode ser lido nem gravado." });

export function registrarRotasDoBrandKit(app, { wrap, log = () => {} }) {
  app.get(
    "/api/spy/clientes/:cliente/brand-kit",
    wrap(async (req, res) => {
      await requireInternalUser(req);
      if (!dbEnabled()) return semBanco(res);
      const cliente = await clienteDaCarteira(req);
      const [linha, estudo] = await Promise.all([
        getBrandKit(cliente),
        // A sugestão é conveniência: o banco falhar aqui não pode esconder o kit.
        getIdentificacaoDoEstudo(cliente).catch(() => null),
      ]);
      res.json({
        kit: kitCompleto(cliente, linha),
        atualizado_em: linha?.atualizado_em ?? null,
        identificacaoDoEstudo: estudo,
      });
    })
  );

  app.put(
    "/api/spy/clientes/:cliente/brand-kit",
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      if (!dbEnabled()) return semBanco(res);
      const cliente = await clienteDaCarteira(req);
      const { kit, erros } = normalizarBrandKit({ ...(req.body?.kit || {}), cliente });
      // Nada é gravado com erro: salvar metade faria alguém achar que o CRM que digitou foi junto.
      if (erros.length) {
        return res.status(400).json({ error: "Alguns campos não puderam ser salvos.", erros });
      }
      await upsertBrandKit(kit, userId);
      const linha = await getBrandKit(cliente);
      log(`brand kit de ${cliente} salvo por ${userId}`);
      res.json({ kit: kitCompleto(cliente, linha), atualizado_em: linha?.atualizado_em ?? null });
    })
  );

  app.get(
    "/api/spy/clientes/:cliente/brand-kit/imagens/:tipo",
    wrap(async (req, res) => {
      await requireInternalUser(req);
      const tipo = tipoDaRota(req);
      const linha = await getBrandKit(String(req.params.cliente || ""));
      const caminho = linha?.imagens?.[tipo];
      const bytes = caminho ? await storageDownload(caminho) : null;
      if (!bytes) return res.status(404).json({ error: "Imagem não encontrada." });
      res.setHeader("Content-Type", tipoDaImagem(bytes) || "application/octet-stream");
      // O caminho muda a cada upload (tem carimbo de tempo), mas a URL desta rota não: cache curto.
      res.setHeader("Cache-Control", "private, max-age=60");
      res.end(bytes);
    })
  );

  app.put(
    "/api/spy/clientes/:cliente/brand-kit/imagens/:tipo",
    // Só esta rota lê corpo binário. O `express.json` global ignora `image/*`, então os bytes
    // chegam intactos aqui.
    express.raw({ type: () => true, limit: MAX_BYTES_IMAGEM }),
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      if (!dbEnabled()) return semBanco(res);
      const cliente = await clienteDaCarteira(req);
      const tipo = tipoDaRota(req);
      const bytes = Buffer.isBuffer(req.body) ? req.body : null;
      const mime = tipoDaImagem(bytes);
      if (!mime) throw new ErroDoPedido("Envie uma imagem PNG, JPEG ou WebP.");

      const anterior = (await getBrandKit(cliente))?.imagens?.[tipo] || null;
      // Carimbo no nome: a imagem nova nunca sobrescreve a velha no mesmo caminho, então uma arte
      // sendo renderizada agora não pega metade de cada uma.
      const caminho = `brand-kits/${cliente}/${tipo}-${Date.now()}.${EXTENSAO[mime]}`;
      await storageUpload(caminho, bytes, mime);
      const imagens = await patchBrandKitImagens(cliente, tipo, caminho, userId);
      if (anterior && anterior !== caminho) await storageRemove(anterior);
      log(`brand kit de ${cliente}: ${tipo} trocado por ${userId} (${bytes.length} bytes)`);
      res.json({ imagens });
    })
  );

  app.delete(
    "/api/spy/clientes/:cliente/brand-kit/imagens/:tipo",
    wrap(async (req, res) => {
      const { userId } = await requireInternalUser(req);
      if (!dbEnabled()) return semBanco(res);
      const cliente = await clienteDaCarteira(req);
      const tipo = tipoDaRota(req);
      const anterior = (await getBrandKit(cliente))?.imagens?.[tipo] || null;
      const imagens = await patchBrandKitImagens(cliente, tipo, null, userId);
      if (anterior) await storageRemove(anterior);
      res.json({ imagens });
    })
  );
}
