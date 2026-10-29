/**
 * A etapa de Conceitos Estratégicos de uma composição (20/10/2026) — o que fala com banco e agente.
 * A lógica pura (catálogo, unicidade, prompts) mora em `conceitos.js`.
 *
 *   1. `runConceitos`   a primeira chamada: o agente decide quantos anúncios e para que uso, deriva
 *                       os ângulos e sugere um conceito por anúncio — ou diz que o material não basta.
 *   2. `gerarConceito`  um conceito novo para UM anúncio: depois de uma rejeição, de uma sugestão
 *                       recusada pela conferência, ou para completar com reciclagem.
 *   3. a composição só é escrita (`runComposition`) quando todos os conceitos estão aprovados — a
 *      rota de confirmar é quem decide isso.
 *
 * ## Duas filas, e por quê
 *
 * As rejeições chegam em rajada (três cliques em três segundos), e cada uma é uma chamada de
 * minutos ao agente. Elas rodam UMA de cada vez por composição (`naFila`): sessões simultâneas do
 * mesmo agente nunca foram verificadas ao vivo, e cada conceito novo precisa ver o anterior para
 * não repeti-lo.
 *
 * Já as GRAVAÇÕES de `conceitos` (aprovar, rejeitar, gravar a sugestão que chegou) são um ler-mudar-
 * gravar de uma coluna jsonb: duas ao mesmo tempo, e uma apaga a outra. Elas passam por `naTrava`,
 * que serializa só esse trecho curto — aprovar um conceito não espera a chamada de minutos acabar.
 *
 * As duas filas são deste processo, em memória: o worker é um processo só (ver `orfas.js`), e o que
 * ficar `gerando` num reinício é destravado no boot.
 */

import {
  buildLeituraEstudoPrompt,
  catalogoComLeitura,
  parseLeituraEstudoReply,
  buildConceitosPrompt,
  buildNovoConceitoPrompt,
  catalogoInicial,
  chavesRejeitadas,
  distribuirConceitos,
  incorporarAngulos,
  normalizarConceito,
  ocupadosExceto,
  parseConceitosReply,
  parseNovoConceitoReply,
  validarConceito,
} from "./conceitos.js";

/** Uma promessa por chave; a próxima tarefa espera a anterior, com sucesso ou falha. */
function fila() {
  const caudas = new Map();
  return (chave, tarefa) => {
    const anterior = caudas.get(chave) || Promise.resolve();
    const atual = anterior.catch(() => {}).then(tarefa);
    const cauda = atual.catch(() => {});
    caudas.set(chave, cauda);
    void cauda.then(() => {
      if (caudas.get(chave) === cauda) caudas.delete(chave);
    });
    return atual;
  };
}

/** Serializa as gravações de `conceitos` de uma composição (trecho curto, sem agente dentro). */
export const naTrava = fila();
/** Serializa as chamadas ao agente de uma composição (minutos cada). */
export const naFila = fila();

/** As partes do material que a etapa de conceitos usa: o Estudo, os outros documentos, os criativos. */
export function fontesDoMaterial(material) {
  const docs = Array.isArray(material.documentos) ? material.documentos : [];
  const estudo = docs.find((d) => d.estudo && d.conteudo_md) || null;
  const documentos = docs.filter((d) => d !== estudo && d.conteudo_md);
  const textoFontes = [estudo?.conteudo_md, ...documentos.map((d) => d.conteudo_md)].filter(Boolean).join("\n\n");
  return { estudo, documentos, criativos: material.criativos || [], textoFontes };
}

/**
 * O que impede a etapa de começar, antes de gastar uma chamada: sem Estudo legível, sem avatares no
 * Estudo, sem análise de criativo pronta. Esses casos não têm "seguir assim mesmo" — não há de onde
 * tirar um conceito —, então a tela só oferece voltar aos insumos.
 */
export function bloqueioDoMaterial({ estudo, criativos }, catalogo) {
  if (!estudo) {
    return {
      motivo: "Não foi possível ler o Estudo de Copy escolhido.",
      sugestao: "Confira no ClickUp se o documento tem conteúdo, ou escolha outro Estudo de Copy.",
    };
  }
  if (!criativos.length) {
    return {
      motivo: "Nenhuma das análises de criativo escolhidas está pronta.",
      sugestao: "Escolha uma análise de criativo que já terminou.",
    };
  }
  if (catalogo?.faltando?.length) {
    return catalogo.leitura_falhou
      ? {
          // Fora do modelo padrão E a leitura pelo agente não achou (ou não conseguiu ler) avatar.
          motivo: `O Estudo de Copy não segue o modelo padrão e a leitura pelo agente não achou os avatares (${catalogo.leitura_falhou}).`,
          sugestao:
            "Confira se o Estudo descreve as personas ou o público (ex.: uma subpágina \"Buyer Personas\") e componha de novo.",
        }
      : {
          motivo: `O Estudo de Copy não tem a seção ${catalogo.faltando.join(", ")}, de onde saem os avatares.`,
          sugestao: "Complete o Estudo de Copy no ClickUp e componha de novo.",
        };
  }
  return null;
}

/**
 * A primeira chamada da etapa.
 *
 * `deps`: `material()` -> o material da composição (`montarMaterial`), `perguntar(content, n)` -> o
 * texto do agente, `ler()` -> a linha, `gravar(patch)`, `log`.
 */
export async function runConceitos({ id, extraPrompt = "", deps }) {
  const log = deps.log || (() => {});
  const { ctx, material } = await deps.material();
  const fontes = fontesDoMaterial(material);
  let catalogo0 = fontes.estudo ? catalogoInicial({ estudo: fontes.estudo, criativos: fontes.criativos }) : null;

  // Estudo fora do modelo padrão (os clientes mais antigos têm os elementos espalhados em
  // subpáginas, com os avatares como "Buyer Personas"): o código não acha os avatares, e o agente
  // os procura. Uma chamada a mais, só nesse caso — e só com análise de criativo pronta, senão a
  // composição para de qualquer jeito e a chamada seria gasta à toa.
  if (catalogo0 && !catalogo0.avatares.length && fontes.criativos.length) {
    log(`[conceitos ${id}] Estudo fora do modelo padrão: pedindo a leitura ao agente`);
    try {
      const leitura = parseLeituraEstudoReply(
        await deps.perguntar(buildLeituraEstudoPrompt({ ficha: ctx.ficha, estudo: fontes.estudo }), 90)
      );
      const r = catalogoComLeitura(catalogo0, leitura, fontes.estudo.conteudo_md);
      log(
        `[conceitos ${id}] leitura do Estudo: ${r.catalogo.avatares.length} avatar(es)` +
          (r.descartados ? `, ${r.descartados} descartado(s) sem trecho verificável` : "") +
          (leitura.semJson ? " — resposta sem o bloco JSON" : "")
      );
      catalogo0 = r.catalogo.avatares.length
        ? r.catalogo
        : { ...r.catalogo, leitura_falhou: leitura.semJson ? "a resposta veio sem o bloco de dados" : "nenhuma persona com trecho verificável" };
    } catch (err) {
      if (deps.signal?.aborted) throw err;
      log(`[conceitos ${id}] leitura do Estudo falhou: ${err?.message || err}`);
      catalogo0 = { ...catalogo0, leitura_falhou: `a chamada falhou: ${String(err?.message || err).slice(0, 160)}` };
    }
  }

  const bloqueio = bloqueioDoMaterial(fontes, catalogo0);
  if (bloqueio) {
    log(`[conceitos ${id}] bloqueada: ${bloqueio.motivo}`);
    await deps.gravar({
      conceitos: [],
      catalogo_copy: catalogo0,
      insumos_insuficientes: { ...bloqueio, bloqueante: true, seguir: false },
    });
    return { bloqueada: true };
  }

  const texto = await deps.perguntar(
    buildConceitosPrompt({ ficha: ctx.ficha, ...fontes, catalogo: catalogo0, extraPrompt }),
    0
  );
  const lido = parseConceitosReply(texto);
  if (lido.semJson || !lido.formatos.length) {
    throw new Error("O agente não devolveu os conceitos num formato legível. Tente compor de novo.");
  }
  const { catalogo, mapa, descartados } = incorporarAngulos(catalogo0, lido.angulosBrutos, fontes.textoFontes);
  if (descartados) log(`[conceitos ${id}] ${descartados} ângulo(s) sem trecho verificável descartado(s)`);
  const slots = distribuirConceitos({ formatos: lido.formatos, conceitosBrutos: lido.conceitosBrutos, mapa, catalogo });

  const insuficiente = !lido.suficiente
    ? {
        motivo: lido.falta || "O agente achou que o material não dá conceitos diferentes para todos os anúncios.",
        sugestao: lido.sugestao,
        bloqueante: false,
        seguir: false,
      }
    : null;
  // Material suficiente: o que ficou sem conceito válido é pedido de novo, já. Insuficiente: espera
  // quem compõe decidir entre escolher mais insumos e seguir assim mesmo.
  const faltam = slots.filter((s) => s.status === "pendente");
  if (!insuficiente) for (const s of faltam) s.status = "gerando";

  await deps.gravar({
    conceitos: slots,
    catalogo_copy: catalogo,
    insumos_insuficientes: insuficiente,
    composicao_md: lido.prosa || null,
  });
  log(
    `[conceitos ${id}] ${slots.length} anúncio(s), ${slots.length - faltam.length} conceito(s) sugerido(s), ` +
      `${catalogo.angulos.length} ângulo(s)` +
      (insuficiente ? " — material insuficiente" : "")
  );
  if (!insuficiente) for (const s of faltam) deps.agendar(s.n);
  return { bloqueada: false, insuficiente: Boolean(insuficiente) };
}

/**
 * Grava a mudança de UM anúncio relendo a linha (ver `naTrava`). `mudar` altera o slot no lugar e
 * devolve colunas extras a gravar, ou `false` para não gravar nada.
 *
 * @returns {Promise<boolean>} se gravou
 */
async function mudarSlot(id, n, deps, mudar) {
  return naTrava(id, async () => {
    const linha = await deps.ler();
    if (!linha || linha.status !== "conceitos") return false;
    const slots = (linha.conceitos || []).map((s) => ({ ...s }));
    const slot = slots.find((s) => s.n === n);
    if (!slot) return false;
    const extra = mudar(slot, slots, linha);
    if (extra === false) return false;
    await deps.gravar({ conceitos: slots, ...(extra || {}) });
    return true;
  });
}

const MAX_TENTATIVAS = 2;

/**
 * Um conceito novo para o anúncio `n`. Duas tentativas: a segunda diz ao agente por que a primeira
 * foi recusada. Sem conceito válido, o anúncio fica em `erro` — e, se ainda não houver reciclagem, a
 * composição passa a "insumos insuficientes", que é onde quem compõe decide.
 */
export async function gerarConceito({ id, n, extraPrompt = "", deps }) {
  const log = deps.log || (() => {});
  const linha0 = await deps.ler();
  if (!linha0 || linha0.status !== "conceitos") return;
  const { ctx, material } = await deps.material();
  const fontes = fontesDoMaterial(material);

  let recusa = "";
  let ultimoMotivo = "";
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
    const atual = await deps.ler();
    if (!atual || atual.status !== "conceitos") return;
    const reciclar = Boolean(atual.insumos_insuficientes?.seguir);
    const prompt =
      buildNovoConceitoPrompt({
        ficha: ctx.ficha,
        ...fontes,
        catalogo: atual.catalogo_copy,
        slots: atual.conceitos || [],
        n,
        reciclar,
        extraPrompt,
      }) + (recusa ? `\n\n# Sua sugestão anterior foi recusada\n${recusa}. Sugira outra.` : "");
    const lido = parseNovoConceitoReply(await deps.perguntar(prompt, 10 + n));

    if (lido.impossivel && !lido.conceitoBruto) {
      await falhar(id, n, deps, lido.impossivel, reciclar);
      log(`[conceitos ${id}] anúncio ${n + 1}: o agente não achou conceito diferente`);
      return;
    }

    let motivo = null;
    let reciclado = false;
    const gravou = await mudarSlot(id, n, deps, (slot, slots, linha) => {
      // Cancelado, ou já resolvido enquanto o agente pensava: a resposta não vale mais.
      if (slot.status !== "gerando") return false;
      const { catalogo, mapa } = incorporarAngulos(linha.catalogo_copy, lido.angulosBrutos, fontes.textoFontes);
      const c = lido.conceitoBruto ? normalizarConceito(lido.conceitoBruto, mapa) : null;
      const v = c
        ? validarConceito(c, {
            catalogo,
            ocupados: ocupadosExceto(slots, n),
            rejeitadas: chavesRejeitadas(slots),
            formatoSaida: slot.formato_saida,
            reciclar: Boolean(linha.insumos_insuficientes?.seguir),
          })
        : { motivo: "o agente não devolveu um conceito", reciclado: false };
      motivo = v.motivo;
      reciclado = v.reciclado;
      if (!v.motivo) Object.assign(slot, { status: "sugerido", conceito: c, reciclado: v.reciclado, error: null });
      // Os ângulos novos ficam no catálogo mesmo se o conceito foi recusado: são material verificado.
      return { catalogo_copy: catalogo };
    });
    if (!gravou) return;
    if (!motivo) {
      log(`[conceitos ${id}] anúncio ${n + 1}: conceito novo sugerido${reciclado ? " (reciclado)" : ""}`);
      return;
    }
    recusa = `O worker recusou: ${motivo}`;
    ultimoMotivo = motivo;
    log(`[conceitos ${id}] anúncio ${n + 1}: tentativa ${tentativa} recusada (${motivo})`);
  }
  await falhar(id, n, deps, `Não consegui um conceito diferente dos outros (${ultimoMotivo}).`, null);
}

/** O anúncio fica sem conceito, com o motivo; sem reciclagem, a decisão vai para quem compõe. */
async function falhar(id, n, deps, motivo, reciclarConhecido) {
  await mudarSlot(id, n, deps, (slot, _slots, linha) => {
    if (slot.status !== "gerando") return false;
    Object.assign(slot, { status: "erro", conceito: null, error: motivo });
    const reciclar = reciclarConhecido ?? Boolean(linha.insumos_insuficientes?.seguir);
    if (reciclar || linha.insumos_insuficientes) return null;
    return {
      insumos_insuficientes: {
        motivo: `Não há conceitos diferentes para todos os anúncios: ${motivo}`,
        sugestao: "Escolha mais documentos ou outra análise de criativo — ou siga assim mesmo, reciclando conceitos em formatos de saída diferentes.",
        bloqueante: false,
        seguir: false,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// As ações de quem compõe. Cada uma devolve o patch a gravar e quais anúncios gerar, ou um erro
// para a rota responder — sem I/O, para a rota fazer tudo sob `naTrava`.
// ---------------------------------------------------------------------------------------------

export class AcaoInvalida extends Error {}

/** Aprovar o conceito sugerido do anúncio `n`. */
export function aprovar(slots, n) {
  const slot = slots.find((s) => s.n === n);
  if (!slot) throw new AcaoInvalida("Este anúncio não existe.");
  if (slot.status !== "sugerido" || !slot.conceito) throw new AcaoInvalida("Este anúncio não tem conceito para aprovar.");
  slot.status = "aprovado";
  return { gerar: [] };
}

/** Rejeitar (ou pedir de novo, quando deu erro) o conceito do anúncio `n`. */
export function rejeitar(slots, n, { motivo = "", por = null, em = new Date().toISOString(), insuficiente = null } = {}) {
  const slot = slots.find((s) => s.n === n);
  if (!slot) throw new AcaoInvalida("Este anúncio não existe.");
  if (slot.status === "gerando") throw new AcaoInvalida("O agente já está sugerindo outro conceito para este anúncio.");
  if (slot.status === "pendente" && insuficiente && !insuficiente.seguir) {
    throw new AcaoInvalida("Decida antes entre escolher mais insumos e seguir assim mesmo.");
  }
  if (slot.conceito) {
    slot.rejeitados = [...(slot.rejeitados || []), { ...slot.conceito, motivo: String(motivo || "").trim().slice(0, 500), por, em }];
  }
  Object.assign(slot, { status: "gerando", conceito: null, reciclado: false, error: null });
  return { gerar: [n] };
}

/** "Seguir assim mesmo": liga a reciclagem e pede conceito para todo anúncio que está sem. */
export function seguirAssimMesmo(slots, insuficiente) {
  if (!insuficiente) throw new AcaoInvalida("Os insumos desta composição bastaram.");
  if (insuficiente.bloqueante) throw new AcaoInvalida("Sem o Estudo de Copy legível não há como seguir. Volte aos insumos.");
  const gerar = [];
  for (const s of slots) {
    if (s.status === "pendente" || s.status === "erro") {
      Object.assign(s, { status: "gerando", error: null });
      gerar.push(s.n);
    }
  }
  return { gerar, insumos_insuficientes: { ...insuficiente, seguir: true } };
}

// ---------------------------------------------------------------------------------------------
// Sem ninguém na tela: o "pular revisão" do orquestrador
// ---------------------------------------------------------------------------------------------

const MAX_RODADAS_SOZINHO = 3;

/**
 * Conduz a etapa sem quem compõe, decidindo o que a tela pediria a uma pessoa: insumos
 * insuficientes -> segue reciclando; anúncio sem conceito -> pede outro; o resto -> aprova. Até
 * `MAX_RODADAS_SOZINHO` voltas; sem conceito para todos depois disso, lança com o motivo.
 *
 * `esperar()` resolve quando a fila de agente da composição esvazia — é ela que diz que a rodada de
 * sugestões agendadas terminou.
 *
 * @returns {Promise<object[]>} os slots, todos aprovados
 */
export async function conduzirSozinho({ id, deps, esperar }) {
  for (let rodada = 0; rodada <= MAX_RODADAS_SOZINHO; rodada += 1) {
    await esperar();
    const decisao = await naTrava(id, async () => {
      const linha = await deps.ler();
      if (!linha || linha.status !== "conceitos") throw new Error("A composição saiu da etapa de conceitos.");
      const insuficiente = linha.insumos_insuficientes;
      if (insuficiente?.bloqueante) throw new Error(insuficiente.motivo);
      const slots = (linha.conceitos || []).map((s) => ({ ...s }));
      if (!slots.length) throw new Error("O agente não sugeriu nenhum conceito.");

      let gerar = [];
      let extra = {};
      if (insuficiente && !insuficiente.seguir) {
        const r = seguirAssimMesmo(slots, insuficiente);
        gerar = r.gerar;
        extra = { insumos_insuficientes: r.insumos_insuficientes };
      } else if (rodada < MAX_RODADAS_SOZINHO) {
        for (const s of slots) if (s.status === "erro" || s.status === "pendente") gerar.push(...rejeitar(slots, s.n).gerar);
      }
      if (!gerar.length) {
        const faltam = slots.filter((s) => !(s.status === "sugerido" || s.status === "aprovado") || !s.conceito);
        if (faltam.length) {
          const motivos = faltam.map((s) => `anúncio ${s.n + 1}: ${s.error || s.status}`).join("; ");
          throw new Error(`Não houve conceito para todos os anúncios (${motivos}).`);
        }
        for (const s of slots) s.status = "aprovado";
      }
      await deps.gravar({ conceitos: slots, ...extra });
      return { gerar, slots };
    });
    if (!decisao.gerar.length) return decisao.slots;
    for (const n of decisao.gerar) deps.agendar(n);
  }
  throw new Error("Não houve conceito para todos os anúncios.");
}
