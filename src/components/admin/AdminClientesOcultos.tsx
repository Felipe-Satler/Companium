import { useCallback, useEffect, useState } from "react";
import { EyeOff, Plus, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/external-supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { recarregarClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { clientMatchKey } from "@/data/clienteAliases";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useProjetosLista } from "@/hooks/useProjetosLista";
import { toast } from "sonner";

/**
 * A migration 20260902 ainda não rodou → o PostgREST responde "Could not find the table
 * 'public.clientes_ocultos' in the schema cache". Mostrar isso cru não diz a ninguém o que
 * fazer, então traduzimos para a ação concreta.
 */
function ehTabelaAusente(msg: string): boolean {
  return /schema cache|does not exist|clientes_ocultos/i.test(msg) && /not find|does not exist/i.test(msg);
}

const AVISO_MIGRATION =
  "A tabela clientes_ocultos ainda não existe no Supabase. Rode a migration " +
  "20260902_clientes_ocultos no SQL Editor do projeto companium-db.";

interface Oculto {
  id: number;
  padrao: string;
  canal: string | null;
  exato: boolean;
  motivo: string | null;
}

const CANAIS = [
  { value: "", label: "Todas as telas" },
  { value: "google", label: "Só Google Ads" },
  { value: "meta", label: "Só Meta Ads" },
  { value: "crm", label: "Só CRM" },
  { value: "overview", label: "Só Relatório/Performance" },
];

/**
 * Clientes escondidos dos filtros — a trava manual que fica POR CIMA da planilha de projetos.
 *
 * Quem entra no dashboard é decidido por `projetos_lista` (só ATIVO). Esta lista serve para o
 * que a planilha não resolve: conta de teste, cliente mal arquivado, nome duplicado. Antes
 * disso era uma constante no código (EXCLUDED_CLIENT_MATCHES), que só mudava com deploy.
 */
export function AdminClientesOcultos() {
  const [rows, setRows] = useState<Oculto[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroTabela, setErroTabela] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [novoPadrao, setNovoPadrao] = useState("");
  // Modo manual: escape p/ quando a planilha não carrega (seletor vazio) ou p/ um nome que
  // não casa exatamente com o slug do dashboard.
  const [manual, setManual] = useState(false);
  // Só clientes ATIVOS entram no seletor: esconder um já inativo não faria nada — ele já está
  // fora por status.
  const { index: projetos, loading: carregandoProjetos } = useProjetosLista();
  const ativos = projetos.ativos;
  const [novoCanal, setNovoCanal] = useState("");
  const [novoMotivo, setNovoMotivo] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("clientes_ocultos")
      .select("id, padrao, canal, exato, motivo")
      .order("padrao", { ascending: true });
    if (error) {
      setErroTabela(ehTabelaAusente(error.message) ? AVISO_MIGRATION : error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setErroTabela(null);
    setRows((data ?? []) as Oculto[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const adicionar = async () => {
    // Normaliza para o mesmo formato de chave que o front usa ao casar nomes: minúsculo, sem
    // acento, "_" entre palavras. Digitar "Dr. Téo de Oliveira" grava "dr_teo_de_oliveira",
    // então o admin não precisa saber o formato interno.
    // No seletor o valor JÁ é o token pronto (vindo da planilha); no modo manual normaliza o
    // que foi digitado p/ o mesmo formato de chave.
    const padrao = manual ? clientMatchKey(novoPadrao.trim()) : novoPadrao.trim();
    if (!padrao) {
      toast.error("Escolha um cliente.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("clientes_ocultos").insert({
      padrao,
      canal: novoCanal || null,
      motivo: novoMotivo.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(
        ehTabelaAusente(error.message)
          ? AVISO_MIGRATION
          : error.message.includes("duplicate")
            ? "Esse cliente já está na lista."
            : error.message,
      );
      return;
    }
    toast.success("Cliente escondido dos filtros.");
    setNovoPadrao("");
    setNovoMotivo("");
    await carregar();
    await recarregarClientesVisiveis();
  };

  const remover = async (id: number) => {
    setBusy(true);
    const { error } = await supabase.from("clientes_ocultos").delete().eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cliente liberado — volta a aparecer nos filtros.");
    await carregar();
    await recarregarClientesVisiveis();
  };

  return (
    <Card className="neu-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <EyeOff className="h-4 w-4 text-primary" />
            Clientes escondidos dos filtros
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Quem aparece no dashboard vem da planilha de projetos (só clientes <strong>ATIVO</strong>).
            Esta lista tira alguém <em>mesmo estando ativo</em> — conta de teste, cliente mal
            arquivado, nome repetido. Por isso o seletor mostra <strong>só clientes ATIVOS</strong>:
            esconder um inativo não faria nada, ele já está fora pelo status. O nome casa como
            palavra inteira, então “icv” pega “Clínica ICV” e não “Medicva”.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void carregar()} disabled={loading || busy} className="neu-button">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Cliente {manual ? "(manual)" : "(ativos)"}
            </label>
            <button
              type="button"
              onClick={() => { setManual((v) => !v); setNovoPadrao(""); }}
              className="text-[10px] text-primary hover:underline"
            >
              {manual ? "escolher da lista" : "digitar manualmente"}
            </button>
          </div>
          {manual ? (
            <Input
              value={novoPadrao}
              onChange={(e) => setNovoPadrao(e.target.value)}
              placeholder="Ex.: Téo de Oliveira"
              className="neu-inset border-0 text-xs"
            />
          ) : (
            <SearchableSelect
              value={novoPadrao}
              onValueChange={setNovoPadrao}
              options={ativos.map((c) => ({ value: c.padrao, label: c.nome }))}
              placeholder={carregandoProjetos ? "Carregando clientes…" : "Escolher cliente ativo"}
              searchPlaceholder="Buscar cliente..."
              emptyText="Nenhum cliente ativo encontrado."
              triggerClassName="w-full"
            />
          )}
        </div>
        <div className="min-w-[170px]">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Onde esconder</label>
          <select
            value={novoCanal}
            onChange={(e) => setNovoCanal(e.target.value)}
            className="neu-inset border-0 rounded-md w-full h-10 px-3 text-xs bg-transparent"
          >
            {CANAIS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Motivo (opcional)</label>
          <Input
            value={novoMotivo}
            onChange={(e) => setNovoMotivo(e.target.value)}
            placeholder="Ex.: conta de teste"
            className="neu-inset border-0 text-xs"
          />
        </div>
        <Button size="sm" onClick={() => void adicionar()} disabled={busy} className="neu-button">
          <Plus className="h-4 w-4" />
          Esconder
        </Button>
      </div>

      {erroTabela && (
        <p className="text-[11px] text-destructive border border-destructive/30 bg-destructive/10 rounded-lg p-2">
          {erroTabela}
        </p>
      )}

      {!manual && !carregandoProjetos && ativos.length === 0 && (
        <p className="text-[11px] text-amber-500">
          Não foi possível ler a planilha de projetos, então não há lista de clientes ativos para
          escolher. Use “digitar manualmente” — ou verifique se a permissão de leitura de
          <code className="mx-1">projetos_lista</code> foi aplicada no Supabase.
        </p>
      )}

      {loading ? (
        <div className="skeleton-loading h-20 rounded-lg" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum cliente escondido — a carteira é exatamente a da planilha de projetos.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-foreground break-all">{r.padrao.replace(/_/g, " ")}</span>
                  {r.canal && (
                    <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/30">
                      {CANAIS.find((c) => c.value === r.canal)?.label ?? r.canal}
                    </Badge>
                  )}
                  {r.exato && (
                    <Badge variant="outline" className="bg-blue-500/15 text-blue-400 border-blue-500/30">
                      Nome exato
                    </Badge>
                  )}
                </div>
                {r.motivo && <p className="text-[11px] text-muted-foreground">{r.motivo}</p>}
              </div>
              <ConfirmActionDialog
                title="Liberar cliente"
                description={
                  <>
                    <span className="font-semibold text-foreground">{r.padrao.replace(/_/g, " ")}</span> volta a
                    aparecer nos filtros (desde que esteja ATIVO na planilha de projetos).
                  </>
                }
                confirmLabel="Liberar"
                onConfirm={() => remover(r.id)}
                trigger={
                  <Button size="sm" variant="outline" disabled={busy} className="neu-button text-muted-foreground">
                    <Trash2 className="h-4 w-4" />
                    Liberar
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
