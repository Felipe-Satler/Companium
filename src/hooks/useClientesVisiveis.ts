import { useEffect, useSyncExternalStore } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { clearCached, dedupedFetch, withRetry } from "@/hooks/dataCache";
import { ProjetoRow, buildProjetosIndex, clienteVisivel, resolveProjeto } from "@/data/squads";
import { isExcludedClient, prettyClientLabel } from "@/data/clienteAliases";
import {
  OcultoRow,
  getVersaoClientesVisiveis,
  setClientesOcultos,
  setResolvedorAtivos,
  subscribeClientesVisiveis,
} from "@/data/clientesVisiveisStore";

/**
 * Carrega as duas fontes que decidem a carteira visível (`projetos_lista` + `clientes_ocultos`)
 * e devolve a `versao` do store, para os hooks de dado entrarem como dependência e recalcular
 * suas listas quando os dados chegam.
 *
 * A carga acontece UMA vez por sessão (dedupedFetch), mesmo com várias telas montando o hook.
 */

let carregando: Promise<void> | null = null;
// Guardado só p/ o diagnóstico abaixo (o gate em si usa o resolvedor injetado no store).
let ultimoIndex: ReturnType<typeof buildProjetosIndex> | null = null;

async function carregar(): Promise<void> {
  // projetos_lista: liga o filtro por ATIVO. Falha ou tabela vazia → filtro DESLIGADO
  // (o dashboard segue mostrando a carteira como antes; ver clientesVisiveisStore).
  try {
    // MESMA chave de cache do useProjetosLista ("projetos_lista"): as duas fontes puxam a MESMA
    // tabela com as MESMAS colunas, e as duas montam juntas na tela CRM. Chave única →
    // dedupedFetch coalesce num só request (antes eram DOIS downloads paginados em paralelo).
    const rows = await dedupedFetch<ProjetoRow[]>("projetos_lista", () =>
      withRetry(async () => {
        const PAGE = 1000;
        const all: ProjetoRow[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await externalSupabase
            .from("projetos_lista")
            .select("cliente, data_inicio, status, plano, lider_revops, crm")
            .order("id", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw Object.assign(new Error(error.message), error);
          const page = (data ?? []) as ProjetoRow[];
          all.push(...page);
          if (page.length < PAGE) break;
        }
        return all;
      }),
    );
    if (rows.length > 0) {
      const index = buildProjetosIndex(rows);
      ultimoIndex = index;
      setResolvedorAtivos((canonical) => {
        const proj = resolveProjeto(index, canonical);
        // Fora da planilha = não é cliente ativo (foi o combinado: "só ATIVO aparece").
        return proj != null && proj.ativo && clienteVisivel(proj);
      });
    } else {
      console.warn("[useClientesVisiveis] projetos_lista vazia — filtro por ATIVO desligado.");
    }
  } catch (e) {
    // Provável causa: a policy de leitura (20260901_projetos_lista_rls) ainda não foi aplicada.
    console.warn("[useClientesVisiveis] não foi possível ler projetos_lista:", (e as Error)?.message);
  }

  // clientes_ocultos: trava manual editável na Administração. Falha = lista vazia (as
  // constantes de clienteAliases seguem valendo como rede de segurança).
  try {
    const ocultos = await dedupedFetch<OcultoRow[]>("clientes_ocultos", () =>
      withRetry(async () => {
        const { data, error } = await externalSupabase
          .from("clientes_ocultos")
          .select("padrao, canal, exato");
        if (error) throw Object.assign(new Error(error.message), error);
        return (data ?? []) as OcultoRow[];
      }),
    );
    setClientesOcultos(ocultos);
  } catch (e) {
    console.warn("[useClientesVisiveis] não foi possível ler clientes_ocultos:", (e as Error)?.message);
  }
}

export function useClientesVisiveis(): number {
  useEffect(() => {
    if (!carregando) carregando = carregar();
    // Registrado aqui (e não em useClientesData) porque este hook monta em TODAS as telas de
    // cliente — em Meta Ads/Google Ads o outro nem chega a rodar.
    (window as unknown as { __carteira?: () => unknown }).__carteira = diagnosticarCarteira;
  }, []);
  return useSyncExternalStore(subscribeClientesVisiveis, getVersaoClientesVisiveis, getVersaoClientesVisiveis);
}

/**
 * Força uma recarga (usado após editar a lista na Administração). Limpa o cache antes: sem
 * isso o dedupedFetch devolveria a versão de até 5 min atrás e a edição não apareceria.
 */
export function recarregarClientesVisiveis(): Promise<void> {
  clearCached("projetos_lista");
  clearCached("clientes_ocultos");
  carregando = carregar();
  return carregando;
}

// União CRUA de clientes vista por último (publicada por useClientesData): todos os nomes de
// Kommo + Ads ANTES de qualquer filtro. O diagnóstico precisa dela,
// mas o REGISTRO da função não pode depender da tela: useClientesData só monta em CRM/Metas,
// então em Meta Ads ou Google Ads `__carteira` ficava indefinida.
let ultimaCanonicalList: string[] | null = null;

export function registrarCanonicalList(uniaoCrua: string[]): void {
  ultimaCanonicalList = uniaoCrua;
}

/**
 * DIAGNÓSTICO da carteira: por que a tela mostra menos clientes do que a planilha tem ATIVOS.
 *
 * Olha dos DOIS lados, e o lado dos DADOS é o que importa:
 *
 *   escondidosSemFicha — cliente que TEM dados no Kommo/Ads e sumiu da tela porque o nome
 *                        dele não resolveu para NENHUMA linha da planilha. É o caso a
 *                        corrigir: pede alias em CLIENT_ALIASES/ADS_CLIENT_ALIASES, ou
 *                        acertar o nome na planilha.
 *   escondidosInativos — tem dados e sumiu porque a planilha diz que não está ativo. Correto,
 *                        é exatamente o que a mudança deveria fazer.
 *   ativosSemDados     — ATIVO na planilha e nenhum dado casou com ele. Cliente novo (ou o
 *                        outro lado do mesmo problema de nome).
 */
export function diagnosticarCarteira(): {
  planilhaAtivos: number;
  naTela: number;
  escondidosSemFicha: string[];
  escondidosInativos: string[];
  ativosSemDados: string[];
} | null {
  if (!ultimoIndex) {
    console.warn("[carteira] projetos_lista ainda não carregou (ou a policy de leitura falhou).");
    return null;
  }
  const canonicalList = ultimaCanonicalList;
  if (!canonicalList) {
    console.warn("[carteira] abra CRM ou Metas primeiro — é de lá que sai a lista de clientes do dashboard.");
    return null;
  }

  const naTela: string[] = [];
  const escondidosSemFicha: string[] = [];
  const escondidosInativos: string[] = [];
  // Fichas cobertas por identidade de objeto (o índice guarda a MESMA ficha em todas as chaves
  // do cliente), então quem casou pelo nome da clínica conta igual a quem casou pelo do médico.
  const cobertas = new Set<object>();

  for (const c of canonicalList) {
    // Slug sem rótulo amigável (o balde "groohub") nunca aparece no dropdown, por decisão
    // antiga e sem relação com status — fora da conta p/ não poluir o diagnóstico.
    if (prettyClientLabel(c).trim() === "") continue;
    const ficha = resolveProjeto(ultimoIndex, c);
    if (ficha) cobertas.add(ficha);
    if (!isExcludedClient(c)) {
      naTela.push(c);
      continue;
    }
    // Escondido: foi por status ou por não achar ficha nenhuma?
    if (!ficha) escondidosSemFicha.push(c);
    else if (!ficha.ativo) escondidosInativos.push(c);
  }

  const ativosSemDados = ultimoIndex.ativos
    .filter((a) => {
      const ficha = resolveProjeto(ultimoIndex!, a.padrao);
      return !ficha || !cobertas.has(ficha);
    })
    .map((a) => a.nome);

  const resumo = {
    planilhaAtivos: ultimoIndex.ativos.length,
    naTela: naTela.length,
    escondidosSemFicha,
    escondidosInativos,
    ativosSemDados,
  };
  console.log(
    `[carteira] planilha ATIVOS=${resumo.planilhaAtivos} · na tela=${resumo.naTela} · com dados=${canonicalList.length}\n` +
      `· TEM dados e sumiu por NÃO achar ficha na planilha (corrigir): ${escondidosSemFicha.length}\n` +
      `· TEM dados e sumiu por estar inativo (correto): ${escondidosInativos.length}\n` +
      `· ATIVO na planilha sem dado casado (novo, ou o outro lado do mesmo nome): ${ativosSemDados.length}`,
  );
  if (escondidosSemFicha.length) console.warn("[carteira] SEM FICHA — precisam de alias:", escondidosSemFicha);
  if (escondidosInativos.length) console.info("[carteira] escondidos por inatividade:", escondidosInativos);
  if (ativosSemDados.length) console.info("[carteira] ativos sem dado casado:", ativosSemDados);
  return resumo;
}
