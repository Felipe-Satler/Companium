// O que o aviso de conclusão (`AvisoDeConclusao`) diz sobre uma composição ou orquestração que
// estava sendo acompanhada — ou `null`, quando ainda não há o que avisar. Lógica pura, fora do
// componente, para dar para testar e para o componente não exportar função (fast refresh).
//
// Desde 20/10/2026 há um estado no meio: `conceitos`. A composição para ali esperando quem compõe
// aprovar os Conceitos Estratégicos, e a orquestração para junto. Antes desta função ele caía no
// "não é rodando nem pronta, então falhou", e o aviso "Composição falhou" saía segundos depois de
// compor — com a composição sugerindo conceitos normalmente.

import type { Composicao } from "@/lib/adComposerApi";
import { foiCancelada, type Orquestracao } from "@/lib/orquestradorApi";

export type FimAcompanhado = { titulo: string; ok: boolean; destino: string };

const destinoDaComposicao = (id: string) => `/marketing/composer/salvas?composicao=${id}`;

/** A vez passou para quem compõe nos conceitos? (O agente terminou de sugerir, ou um insumo trava.) */
function conceitosEsperandoDecisao(c: Pick<Composicao, "conceitos" | "insumos_insuficientes">) {
  const slots = c.conceitos ?? [];
  if (c.insumos_insuficientes) return true;
  return slots.length > 0 && !slots.some((s) => s.status === "gerando");
}

export function fimDaComposicao(c: Composicao, nome: string): FimAcompanhado | null {
  if (c.status === "running") return null;
  if (c.status === "conceitos") {
    if (!conceitosEsperandoDecisao(c)) return null;
    const bloqueio = c.insumos_insuficientes?.bloqueante ? c.insumos_insuficientes.motivo : null;
    return {
      titulo: bloqueio
        ? `Composição parada nos insumos — ${nome}: ${bloqueio}`
        : `Conceitos prontos para aprovação — ${nome}`,
      ok: !bloqueio,
      destino: destinoDaComposicao(c.id),
    };
  }
  // Pronta = em revisão, desde 19/10/2026: o aviso chama para revisar, não diz que está salva.
  const pronta = c.status === "revisao" || c.status === "ok";
  return {
    titulo: pronta ? `Anúncios prontos para revisão — ${nome}` : `Composição falhou — ${nome}`,
    ok: pronta,
    destino: destinoDaComposicao(c.id),
  };
}

export function fimDaOrquestracao(o: Orquestracao, nome: string): FimAcompanhado | null {
  if (o.status === "running") return null;
  return {
    titulo: foiCancelada(o)
      ? `Orquestração cancelada — ${nome}`
      : o.status === "conceitos"
        ? `Conceitos prontos para aprovação — ${nome}`
        : o.status === "revisao"
          ? `Anúncios prontos para revisão — ${nome}`
          : o.status === "ok"
            ? `Orquestração concluída — ${nome}`
            : `Orquestração falhou — ${nome}`,
    ok: o.status === "ok" || o.status === "revisao" || o.status === "conceitos",
    destino: `/marketing/orquestrador?orquestracao=${o.id}`,
  };
}
