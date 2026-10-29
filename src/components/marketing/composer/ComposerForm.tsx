import { useMemo } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { LibraryEntrySummary } from "@/lib/adSpyApi";
import { ordenarAnalises } from "@/components/marketing/composer/ordenarAnalises";
import { formatosDisponiveis } from "../../../../shared/ad-formats";

export type ClienteOpcao = {
  /** `padrao` — a mesma chave com que o worker casa o cliente. */
  padrao: string;
  nome: string;
  especialidades: string[];
};

export type ComposerFormValues = {
  cliente: string;
  libraryEntryId: string;
  formato: string;
  extraPrompt: string;
};

/** Marca as análises que casam com a especialidade do cliente. Não é decoração: é o atalho. */
const ESTRELA = "★ ";
const SEM_ANALISE = "";

type Props = {
  clientes: ClienteOpcao[];
  analises: LibraryEntrySummary[];
  values: ComposerFormValues;
  onChange: (patch: Partial<ComposerFormValues>) => void;
  onSubmit: () => void;
  enviando: boolean;
  carregandoAnalises: boolean;
};

export function ComposerForm({
  clientes,
  analises,
  values,
  onChange,
  onSubmit,
  enviando,
  carregandoAnalises,
}: Props) {
  const cliente = clientes.find((c) => c.padrao === values.cliente) ?? null;

  const opcoesAnalise = useMemo(() => {
    const ordenadas = ordenarAnalises(analises, cliente?.especialidades ?? []);
    return ordenadas.map(({ entry, casa }) => ({
      value: entry.id,
      label: `${casa ? ESTRELA : ""}${entry.titulo || entry.tema}`,
    }));
  }, [analises, cliente]);

  const formatos = useMemo(() => formatosDisponiveis(), []);
  const formatoEscolhido = formatos.find((f) => f.id === values.formato) ?? null;
  const podeEnviar = Boolean(values.cliente && values.formato) && !enviando;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Cliente</Label>
          <SearchableSelect
            value={values.cliente}
            onValueChange={(v) => onChange({ cliente: v })}
            options={clientes.map((c) => ({ value: c.padrao, label: c.nome }))}
            placeholder="Escolha o cliente"
            searchPlaceholder="Buscar cliente"
            emptyText="Nenhum cliente ativo."
            allOption={null}
            triggerClassName="w-full"
          />
          {cliente && cliente.especialidades.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {cliente.especialidades.join(", ")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Formato de destino</Label>
          <SearchableSelect
            value={values.formato}
            onValueChange={(v) => onChange({ formato: v })}
            options={formatos.map((f) => ({ value: f.id, label: f.label }))}
            placeholder="Escolha o formato"
            searchPlaceholder="Buscar formato"
            emptyText="Nenhum formato."
            allOption={null}
            triggerClassName="w-full"
          />
          {formatoEscolhido && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {formatoEscolhido.resumo}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Minerações Salvas</Label>
        <SearchableSelect
          value={values.libraryEntryId}
          onValueChange={(v) => onChange({ libraryEntryId: v === SEM_ANALISE ? "" : v })}
          options={opcoesAnalise}
          placeholder={carregandoAnalises ? "Carregando análises…" : "Escolha uma análise"}
          searchPlaceholder="Buscar análise"
          emptyText="Nenhuma análise salva na Biblioteca."
          allOption={{ value: SEM_ANALISE, label: "Sem análise (só o cliente)" }}
          triggerClassName="w-full"
        />
        <p className="text-[11px] text-muted-foreground">
          {ESTRELA}casa com a especialidade do cliente. Sem análise, a ideia sai só com o contexto
          do cliente.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="composer-extra">
          Instrução (opcional)
        </Label>
        <Textarea
          id="composer-extra"
          value={values.extraPrompt}
          onChange={(e) => onChange({ extraPrompt: e.target.value })}
          placeholder="Ex.: foque em quem tem medo de anestesia; é para a campanha de novembro"
          className="min-h-[70px] text-xs"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={onSubmit} disabled={!podeEnviar} size="sm">
          {enviando ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Compor anúncio
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Leva alguns minutos. Dá para sair da tela: a composição fica no histórico.
        </span>
      </div>
    </div>
  );
}
