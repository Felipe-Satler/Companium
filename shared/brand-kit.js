/**
 * Brand kit de um cliente — DADO COMPARTILHADO entre a tela (Central de Clientes › Brand kit), o
 * worker (que grava e que monta a arte) e os templates de post.
 *
 * Mora fora de `src/` pelo mesmo motivo de `ad-formats.js`: quem valida no worker e quem desenha na
 * tela leem a MESMA definição. Um campo que a tela aceitasse e o worker descartasse sumiria em
 * silêncio no primeiro salvar.
 *
 * ## O que é e o que não é
 *
 * É o que a arte PODE usar: cores, fontes, logo, contatos, endereço, a identificação do médico.
 * Se cada elemento entra numa arte específica é decisão da criação do estático (as chaves "incluir /
 * não incluir"), não daqui — por isso nenhum campo é obrigatório para salvar.
 *
 * As imagens (logo, logo para fundo escuro, foto do médico) não passam por `normalizarBrandKit`:
 * chegam por upload, o worker grava o caminho no bucket, e a tela só as mostra. Aceitar caminho
 * vindo do navegador deixaria alguém apontar o logo de um cliente para o arquivo de outro.
 *
 * ## A identificação mora aqui
 *
 * Nome, CRM/UF e RQE são a fonte da arte. O Estudo de Copy também os traz (é de lá que a assinatura
 * do vídeo sai), e a tela oferece preencher a partir dele — mas é aqui que a pessoa confere, porque o
 * CRM numa peça publicada não pode ser o que um parser achou num documento.
 */

import { normalizarHex } from "./paleta.js";

/**
 * As fontes oferecidas. Todas do Google Fonts, mas HOSPEDADAS por nós (`public/fonts/posts/`, baixadas
 * por `scripts/baixar-fontes-posts.mjs`): a CSP do site só aceita fonte do próprio domínio, e o
 * preview da tela tem de usar o mesmo arquivo que o render do worker. Só famílias com 400 e 700 —
 * os pesos que os templates usam; uma sem 700 sairia com negrito sintetizado pelo navegador.
 */
export const FONTES = [
  { id: "Inter", categoria: "sem serifa" },
  { id: "Montserrat", categoria: "sem serifa" },
  { id: "Poppins", categoria: "sem serifa" },
  { id: "DM Sans", categoria: "sem serifa" },
  { id: "Work Sans", categoria: "sem serifa" },
  { id: "Nunito", categoria: "sem serifa" },
  { id: "Raleway", categoria: "sem serifa" },
  { id: "Lato", categoria: "sem serifa" },
  { id: "Open Sans", categoria: "sem serifa" },
  { id: "Playfair Display", categoria: "serifa" },
  { id: "Lora", categoria: "serifa" },
  { id: "Merriweather", categoria: "serifa" },
  { id: "Cormorant Garamond", categoria: "serifa" },
  { id: "Libre Baskerville", categoria: "serifa" },
];

export const FONTE_PADRAO = "Inter";

const FONTE_IDS = new Set(FONTES.map((f) => f.id));

/** Os tipos de imagem do kit. O id é o nome do arquivo no bucket. */
export const IMAGENS_DO_KIT = [
  { id: "logo", label: "Logo", ajuda: "Para fundo claro. PNG com fundo transparente funciona melhor." },
  { id: "logo_escuro", label: "Logo para fundo escuro", ajuda: "Opcional. Sem ele, a capa escura usa o logo comum." },
  { id: "foto_medico", label: "Foto do médico", ajuda: "Opcional. Foto real — nunca gerada por IA." },
];

export const IMAGEM_IDS = IMAGENS_DO_KIT.map((i) => i.id);

/** O que a imagem pode ser. SVG fica de fora: é script em potencial, e o render abriria ele. */
export const MIMES_DE_IMAGEM = ["image/png", "image/jpeg", "image/webp"];
export const MAX_BYTES_IMAGEM = 8 * 1024 * 1024;

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
  "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export const MAX_ENDERECOS = 5;

/**
 * Os elementos do kit que uma arte pode ou não incluir. É a lista das chaves da pré-etapa da
 * criação do estático, na ordem em que aparecem. `identificacao` (CRM/RQE) é a única cuja chave
 * pode vir TRAVADA — quem decide é `shared/regras-identificacao.js`.
 */
export const ELEMENTOS_DA_ARTE = [
  { id: "logo", label: "Logo" },
  { id: "nome_clinica", label: "Nome da clínica" },
  { id: "foto_medico", label: "Foto do médico" },
  { id: "identificacao", label: "Nome, CRM e RQE" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telefone", label: "Telefone" },
  { id: "instagram", label: "Instagram" },
  { id: "site", label: "Site" },
  { id: "email", label: "E-mail" },
  { id: "endereco", label: "Endereço" },
];

/**
 * O que uma foto da arte pode ser. Só foto REAL, enviada pela equipe: IA nunca gera pessoa nem
 * resultado. Antes/depois e foto de resultado de paciente não entram (regra do Composer, CFM).
 */
export const TIPOS_DE_FOTO = [
  { id: "medico", label: "Foto do médico" },
  { id: "procedimento", label: "Procedimento" },
  { id: "estrutura", label: "Estrutura da clínica" },
  { id: "equipe", label: "Equipe" },
  { id: "outro", label: "Outra" },
];

/** O kit tem o dado deste elemento? Sem ele, a chave da pré-etapa nem liga. */
export function kitTemElemento(kit, id) {
  const k = kit || {};
  switch (id) {
    case "logo":
      return Boolean(k.imagens?.logo);
    case "nome_clinica":
      return Boolean(k.nome_clinica);
    case "foto_medico":
      return Boolean(k.imagens?.foto_medico);
    case "endereco":
      return Array.isArray(k.enderecos) && k.enderecos.length > 0;
    case "identificacao":
      return Boolean(k.identificacao?.nome && k.identificacao?.crm && k.identificacao?.uf);
    default:
      return Boolean(k.contatos?.[id]);
  }
}

const LIMITES = {
  nome_clinica: 80,
  nome: 100,
  crm: 12,
  rqe: 40,
  pos_graduacao: 120,
  whatsapp: 30,
  telefone: 30,
  instagram: 40,
  site: 100,
  email: 100,
  rotulo: 40,
  endereco: 200,
};

const texto = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Um kit vazio, com a forma inteira: a tela edita sobre ele sem testar campo por campo. */
export function kitVazio(cliente = "") {
  return {
    cliente,
    nome_clinica: "",
    paleta: { primaria: null, secundaria: null, terciaria: null },
    fontes: { titulo: FONTE_PADRAO, texto: FONTE_PADRAO },
    contatos: { whatsapp: "", telefone: "", instagram: "", site: "", email: "" },
    enderecos: [],
    identificacao: { nome: "", crm: "", uf: "", rqe: "", pos_graduacao: "" },
    bio_conferida: false,
    imagens: { logo: null, logo_escuro: null, foto_medico: null },
  };
}

/** "@Clinica.X", "instagram.com/clinica.x/" -> "clinica.x". */
export function normalizarInstagram(v) {
  const s = texto(v, 200)
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^[a-z0-9._]{1,30}$/i.test(s) ? s.toLowerCase() : "";
}

/**
 * O kit que veio da tela, limpo: textos aparados e cortados, cores validadas, fontes da lista.
 *
 * Não recusa o kit por causa de um campo: devolve o que deu para aproveitar e, em `erros`, o que foi
 * descartado — a rota responde 400 com eles, e a tela mostra ao lado do campo. Salvar metade do kit
 * em silêncio faria alguém achar que o CRM foi gravado.
 *
 * @returns {{ kit: object, erros: { campo: string, detalhe: string }[] }}
 */
export function normalizarBrandKit(bruto) {
  const b = bruto && typeof bruto === "object" ? bruto : {};
  const erros = [];
  const kit = kitVazio(texto(b.cliente, 200));

  kit.nome_clinica = texto(b.nome_clinica, LIMITES.nome_clinica);

  for (const papel of ["primaria", "secundaria", "terciaria"]) {
    const v = b.paleta?.[papel];
    if (v == null || v === "") continue;
    const h = normalizarHex(v);
    if (h) kit.paleta[papel] = h;
    else erros.push({ campo: `paleta.${papel}`, detalhe: `"${String(v).slice(0, 20)}" não é uma cor (#RRGGBB)` });
  }

  for (const papel of ["titulo", "texto"]) {
    const v = b.fontes?.[papel];
    if (v == null || v === "") continue;
    if (FONTE_IDS.has(v)) kit.fontes[papel] = v;
    else erros.push({ campo: `fontes.${papel}`, detalhe: `a fonte "${String(v).slice(0, 40)}" não está na lista` });
  }

  const c = b.contatos || {};
  kit.contatos.whatsapp = texto(c.whatsapp, LIMITES.whatsapp);
  kit.contatos.telefone = texto(c.telefone, LIMITES.telefone);
  kit.contatos.site = texto(c.site, LIMITES.site).replace(/^https?:\/\//i, "").replace(/\/$/, "");
  kit.contatos.email = texto(c.email, LIMITES.email).toLowerCase();
  if (kit.contatos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kit.contatos.email)) {
    erros.push({ campo: "contatos.email", detalhe: "e-mail inválido" });
    kit.contatos.email = "";
  }
  if (c.instagram) {
    kit.contatos.instagram = normalizarInstagram(c.instagram);
    if (!kit.contatos.instagram) erros.push({ campo: "contatos.instagram", detalhe: "@ do Instagram inválido" });
  }

  kit.enderecos = (Array.isArray(b.enderecos) ? b.enderecos : [])
    .map((e) => ({ rotulo: texto(e?.rotulo, LIMITES.rotulo), linha: texto(e?.linha, LIMITES.endereco) }))
    .filter((e) => e.linha)
    .slice(0, MAX_ENDERECOS);

  const id = b.identificacao || {};
  kit.identificacao.nome = texto(id.nome, LIMITES.nome);
  // O CRM é número; o que vier junto ("CRM/RS 12345", "12.345") é ruído de digitação.
  kit.identificacao.crm = texto(id.crm, 40).replace(/\D/g, "").slice(0, LIMITES.crm);
  if (id.crm && !kit.identificacao.crm) erros.push({ campo: "identificacao.crm", detalhe: "o CRM precisa ter números" });
  const uf = texto(id.uf, 2).toUpperCase();
  if (uf && !UFS.includes(uf)) erros.push({ campo: "identificacao.uf", detalhe: `"${uf}" não é uma UF` });
  kit.identificacao.uf = UFS.includes(uf) ? uf : "";
  kit.identificacao.rqe = texto(id.rqe, LIMITES.rqe);
  kit.identificacao.pos_graduacao = texto(id.pos_graduacao, LIMITES.pos_graduacao);

  kit.bio_conferida = b.bio_conferida === true;
  return { kit, erros };
}

/**
 * A linha de identificação, como vai na arte e na legenda: "Dr. Fulano | CRM/RS 12345 | RQE 678".
 * Sem RQE e divulgando pós-graduação, a regra do CFM pede "NÃO ESPECIALISTA" em caixa alta —
 * quem decide se o caso se aplica é `regras-identificacao.js`; aqui só se escreve.
 */
export function linhaDeIdentificacao(identificacao, { naoEspecialista = false } = {}) {
  const id = identificacao || {};
  const partes = [];
  if (id.nome) partes.push(id.nome);
  if (id.crm) partes.push(`CRM${id.uf ? `/${id.uf}` : ""} ${id.crm}`);
  if (id.rqe) partes.push(`RQE ${id.rqe}`);
  else if (naoEspecialista) partes.push("NÃO ESPECIALISTA");
  return partes.join(" | ");
}

/** O kit tem o mínimo para uma arte sair com identificação: nome e CRM com UF. */
export function temIdentificacao(kit) {
  const id = kit?.identificacao || {};
  return Boolean(id.nome && id.crm && id.uf);
}
