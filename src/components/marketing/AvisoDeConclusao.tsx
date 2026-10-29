import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { obterComposicao } from "@/lib/adComposerApi";
import {
  aoMudarAcompanhados,
  lerAcompanhados,
  soltar,
  type Acompanhado,
} from "@/lib/acompanhamento";
import { obterOrquestracao } from "@/lib/orquestradorApi";
import { fimDaComposicao, fimDaOrquestracao, type FimAcompanhado } from "@/lib/fimDoAcompanhamento";

/**
 * Avisa quando uma orquestração ou composição disparada neste navegador termina.
 *
 * Montado UMA vez, acima das rotas, e sem desenhar nada. Só trabalha quando há algo sendo
 * acompanhado (`lib/acompanhamento`): sem isso não faz requisição nenhuma, então não custa nada a
 * quem nunca abre o Composer — nem ao usuário-cliente, que não tem como disparar.
 *
 * Três avisos, do mais discreto ao mais insistente, porque a pessoa pode estar em três lugares:
 *   - em outra tela do app      -> o toast, com o atalho para abrir;
 *   - em outra aba do navegador -> o título da aba muda até ela voltar;
 *   - em outro programa         -> a notificação do sistema, se ela permitiu.
 *
 * `setInterval` próprio em vez do react-query: o polling das telas para de propósito com a aba em
 * segundo plano, e este é justamente o caso em que a aba está em segundo plano.
 */

const INTERVALO_MS = 8000;
// Quantas leituras seguidas podem falhar antes de desistir de um item. Uma falha só é rede
// piscando ou o worker reiniciando num deploy — justamente quando o aviso mais importa.
const MAX_FALHAS = 5;

type Fim = FimAcompanhado;

async function conferir(item: Acompanhado, token: string): Promise<Fim | null> {
  if (item.tipo === "orquestracao") {
    const { orquestracao } = await obterOrquestracao(token, item.id);
    return fimDaOrquestracao(orquestracao, item.nome);
  }
  const { composition } = await obterComposicao(token, item.id);
  return fimDaComposicao(composition, item.nome);
}

export function AvisoDeConclusao() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const navigate = useNavigate();
  const [itens, setItens] = useState<Acompanhado[]>(lerAcompanhados);
  // O título original da aba, guardado na primeira troca, para devolver quando a pessoa voltar.
  const tituloOriginal = useRef<string | null>(null);
  const falhas = useRef(new Map<string, number>());

  useEffect(() => aoMudarAcompanhados(() => setItens(lerAcompanhados())), []);

  useEffect(() => {
    const restaurar = () => {
      if (!document.hidden && tituloOriginal.current !== null) {
        document.title = tituloOriginal.current;
        tituloOriginal.current = null;
      }
    };
    document.addEventListener("visibilitychange", restaurar);
    return () => document.removeEventListener("visibilitychange", restaurar);
  }, []);

  useEffect(() => {
    if (!token || !itens.length) return;

    const avisar = (fim: Fim) => {
      const abrir = () => navigate(fim.destino);
      (fim.ok ? toast.success : toast.message)(fim.titulo, {
        duration: 15000,
        action: { label: "Abrir", onClick: abrir },
      });
      if (!document.hidden) return;
      if (tituloOriginal.current === null) tituloOriginal.current = document.title;
      document.title = `${fim.ok ? "✓" : "•"} ${fim.titulo}`;
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const n = new Notification(fim.titulo, { tag: fim.destino });
          n.onclick = () => {
            window.focus();
            abrir();
            n.close();
          };
        }
      } catch {
        /* notificação do sistema é o terceiro aviso: sem ela, os outros dois já saíram */
      }
    };

    let vivo = true;
    const rodada = async () => {
      for (const item of lerAcompanhados()) {
        try {
          const fim = await conferir(item, token);
          if (!vivo) return;
          falhas.current.delete(item.id);
          if (!fim) continue;
          // Solta ANTES de avisar: outra aba do app faz a mesma rodada, e só a que soltar primeiro
          // deve avisar. Não é uma trava perfeita — duas abas no mesmo instante avisam as duas.
          if (!lerAcompanhados().some((x) => x.id === item.id)) continue;
          soltar(item.id);
          avisar(fim);
        } catch {
          // Apagada ou sem permissão: não há fim para anunciar, e sem um teto a pergunta se
          // repetiria para sempre por algo que não existe mais.
          const n = (falhas.current.get(item.id) ?? 0) + 1;
          falhas.current.set(item.id, n);
          if (vivo && n >= MAX_FALHAS) {
            falhas.current.delete(item.id);
            soltar(item.id);
          }
        }
      }
    };
    const timer = setInterval(rodada, INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, [token, itens, navigate]);

  return null;
}
