import { createContext, useContext, useEffect, useMemo, ReactNode } from "react";
import { startOfMonth } from "date-fns";
import { usePersistedState } from "@/hooks/usePersistedState";
import { ClientesFiltersState } from "@/components/clientes/ClientesFilters";
import { clientCmpKey } from "@/data/clienteAliases";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Filtros COMPARTILHADOS entre todas as telas de /clientes (Relatório Geral, Meta Ads,
 * Google Ads, CRM e Performance). Escolher cliente/médico/origem/especialidade/período numa
 * página passa a refletir em todas as outras — um único estado persistido em localStorage.
 *
 * O `client` é sempre o SLUG CANÔNICO (estilo Kommo, ex.: "Gustavo_Nobre"). As telas de Ads,
 * cujo dropdown lista nomes crus da conta, canonicalizam na entrada e traduzem de volta p/ o
 * nome cru só no fetch (ver buildAdsClientOptions / clientCmpKey). A comparação entre páginas
 * é feita por `clientCmpKey` (tolerante a caixa/acento/underscore), nunca por string exata.
 *
 * PERÍODO PADRÃO ROLANTE: o default gerencial é "1º dia do mês atual → hoje". Esse período
 * NÃO pode ficar congelado no localStorage — se congelasse, ao virar o mês a tela continuaria
 * mostrando o mês anterior (e, pior, a edição de "planejado" gravaria a meta no mês velho, que
 * é ancorado em `dateFrom`). Por isso guardamos um `dateMode`:
 *   - "auto":   período é o default rolante → recomputado p/ o mês atual a cada montagem.
 *   - "custom": usuário escolheu um período no seletor (ou limpou filtros) → persiste como está.
 * Trocar a data no seletor vira "custom"; mudar apenas cliente/origem/etc. mantém "auto".
 */

// Default gerencial UNIFICADO: 1º dia do mês atual → hoje (avaliado no mount).
// Antes cada página tinha o seu (a de Google abria o ano inteiro); agora o período é único.
function getSharedDefaults(): ClientesFiltersState {
  const now = new Date();
  return {
    dateFrom: startOfMonth(now),
    dateTo: now,
    client: "all",
    especialidade: "all",
    origem: [],
    medico: [],
    tags: [],
    tagsMode: "include",
    // Padrão = carteira ativa. Quem quiser olhar um cliente que já saiu troca no botão da tela.
    apenasAtivos: true,
  };
}

type DateMode = "auto" | "custom";

interface PersistedShape {
  filters: ClientesFiltersState;
  dateMode: DateMode;
  /**
   * MEMÓRIA de médico POR CLIENTE (chave = clientCmpKey). O médico é específico de cada
   * cliente, então ao TROCAR de cliente guardamos o médico do cliente que sai e restauramos
   * o do cliente que entra — sem isso, voltar a um cliente perdia o médico filtrado e, no CRM,
   * o "planejado por médico" (só Lia) revertia p/ o planejado geral, parecendo que o valor
   * cadastrado tinha mudado. Chave "all" nunca tem médico.
   */
  medicoByClient?: Record<string, string[]>;
}

function getInitialPersisted(): PersistedShape {
  return { filters: getSharedDefaults(), dateMode: "auto", medicoByClient: {} };
}

// Igualdade de datas tolerante a undefined (compara pelo timestamp).
const sameDate = (a?: Date, b?: Date) => (a ? a.getTime() : null) === (b ? b.getTime() : null);

interface ClientesFiltersContextValue {
  filters: ClientesFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<ClientesFiltersState>>;
  /** Atualiza um subconjunto dos campos (usa updater funcional — seguro p/ patches em sequência). */
  patch: (partial: Partial<ClientesFiltersState>) => void;
  /** "Limpar filtros": zera tudo (datas → undefined = todo o histórico). */
  clear: () => void;
}

const ClientesFiltersContext = createContext<ClientesFiltersContextValue | null>(null);

export function ClientesFiltersProvider({ children }: { children: ReactNode }) {
  // v2: shape passou de ClientesFiltersState p/ { filters, dateMode } — chave nova descarta
  // o período congelado da v1 (que grudava no mês da 1ª visita).
  // v3: `medico` passou de string ("all") p/ string[] (multi-seleção) — chave nova descarta
  // o valor antigo do localStorage, que quebraria o .filter/.includes do novo tipo.
  // v4: novos campos `tags: string[]` + `tagsMode` ("include"/"exclude") — chave nova garante que
  // todo shape persistido tenha o array (senão filters.tags viria undefined, quebrando .length/.includes).
  const [persisted, setPersisted] = usePersistedState<PersistedShape>(
    "clientes.sharedFilters.v4",
    getInitialPersisted,
  );

  // Usuário-CLIENTE: o filtro de cliente fica TRAVADO no cliente vinculado a ele. Qualquer
  // tentativa de trocar (dropdown escondido, ou valor antigo do localStorage) é ignorada.
  const { clientUser } = useAuth();
  const lockedClient = clientUser?.slug ?? null;

  // Ao montar (troca de dia/mês, reload): se o período ainda é o default rolante ("auto"),
  // recomputa p/ o mês atual → hoje. Assim ao virar o mês a tela acompanha e a edição de
  // planejado passa a ancorar no mês corrente. Períodos escolhidos pelo usuário ("custom")
  // são preservados.
  useEffect(() => {
    setPersisted((p) => {
      if (p.dateMode !== "auto") return p;
      const d = getSharedDefaults();
      if (sameDate(p.filters.dateFrom, d.dateFrom) && sameDate(p.filters.dateTo, d.dateTo)) return p;
      return { ...p, filters: { ...p.filters, dateFrom: d.dateFrom, dateTo: d.dateTo } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aplica um novo estado de filtros. Se as DATAS mudarem, o período vira "custom" (persistido
  // como escolhido); mudar só cliente/especialidade/origem/médico mantém o modo atual — então o
  // default continua rolando de mês em mês.
  const applyFilters = (updater: React.SetStateAction<ClientesFiltersState>) => {
    setPersisted((p) => {
      const prev = p.filters;
      let next = typeof updater === "function" ? (updater as (s: ClientesFiltersState) => ClientesFiltersState)(prev) : updater;
      // Usuário-cliente: nunca deixa o cliente sair do cliente vinculado.
      if (lockedClient) next = { ...next, client: lockedClient };
      const dateChanged = !sameDate(next.dateFrom, prev.dateFrom) || !sameDate(next.dateTo, prev.dateTo);

      // Memória de médico por cliente. Ao TROCAR de cliente: salva o médico do cliente que sai
      // e RESTAURA o do cliente que entra (ignora o `medico` do patch, tipicamente [] vindo dos
      // dropdowns de cliente). No MESMO cliente: apenas registra a escolha de médico atual.
      let mem = p.medicoByClient ?? {};
      const prevKey = clientCmpKey(prev.client);
      const nextKey = clientCmpKey(next.client);
      if (prevKey !== nextKey) {
        mem = { ...mem, [prevKey]: prev.medico ?? [] };
        // Ao TROCAR de cliente, zera os filtros específicos do cliente que sai
        // (origem/especialidade/tags) — senão uma tag que só existe no cliente anterior
        // "viaja" p/ o novo cliente, que não a possui, e zera todos os números. O PERÍODO
        // é preservado (não mexe em dateFrom/dateTo nem em dateMode). O médico segue a
        // memória por cliente (restaura o do cliente que entra, tipicamente vazio).
        next = {
          ...next,
          medico: mem[nextKey] ?? [],
          especialidade: "all",
          origem: [],
          tags: [],
          tagsMode: "include",
        };
      } else if (JSON.stringify(next.medico ?? []) !== JSON.stringify(prev.medico ?? [])) {
        mem = { ...mem, [nextKey]: next.medico ?? [] };
      }

      return { filters: next, dateMode: dateChanged ? "custom" : p.dateMode, medicoByClient: mem };
    });
  };

  const setFilters: React.Dispatch<React.SetStateAction<ClientesFiltersState>> = (value) => applyFilters(value);

  const patch = (partial: Partial<ClientesFiltersState>) =>
    applyFilters((prev) => ({ ...prev, ...partial }));

  const clear = () =>
    // "Limpar filtros": reset total, inclusive a memória de médico por cliente.
    setPersisted({
      filters: {
        dateFrom: undefined,
        dateTo: undefined,
        client: "all",
        apenasAtivos: true,
        especialidade: "all",
        origem: [],
        medico: [],
        tags: [],
        tagsMode: "include",
      },
      dateMode: "custom",
      medicoByClient: {},
    });

  // Filtros expostos: p/ usuário-cliente, o `client` é SEMPRE o cliente vinculado (mesmo que o
  // localStorage tenha outro valor antigo), garantindo consistência já no 1º render.
  const effectiveFilters = useMemo(
    () => (lockedClient ? { ...persisted.filters, client: lockedClient } : persisted.filters),
    [persisted.filters, lockedClient],
  );

  return (
    <ClientesFiltersContext.Provider value={{ filters: effectiveFilters, setFilters, patch, clear }}>
      {children}
    </ClientesFiltersContext.Provider>
  );
}

export function useClientesFilters(): ClientesFiltersContextValue {
  const ctx = useContext(ClientesFiltersContext);
  if (!ctx) {
    throw new Error("useClientesFilters precisa estar dentro de <ClientesFiltersProvider>");
  }
  return ctx;
}
