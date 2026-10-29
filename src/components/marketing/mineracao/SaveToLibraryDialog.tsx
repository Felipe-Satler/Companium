import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useEspecialidades } from "@/hooks/useEspecialidades";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTitle: string;
  selectedCount: number;
  onSave: (input: { titulo: string; especialidade: string }) => void;
  isSaving: boolean;
};

/**
 * Salvar na Biblioteca. Pede O segmento da análise — um só.
 *
 * Um só, e principal: a análise é classificada por ele e encontrada por ele. Já aceitou vários, o
 * que espalhava a mesma análise por segmentos onde ela não era a resposta certa.
 *
 * A lista vem de `useEspecialidades` — a MESMA do filtro de /clientes (tabela `clientes` via
 * `v_cliente_especialidades`), já com os erros de digitação normalizados. Reaproveitar é o que
 * garante que "Cirurgia Plástica" salva aqui case com o filtro da Biblioteca, em vez de virar uma
 * variante escrita à mão.
 */
export function SaveToLibraryDialog({
  open,
  onOpenChange,
  defaultTitle,
  selectedCount,
  onSave,
  isSaving,
}: Props) {
  const { especialidadeOptions, loading } = useEspecialidades();
  const [titulo, setTitulo] = useState(defaultTitle);
  const [especialidade, setEspecialidade] = useState("");

  useEffect(() => {
    if (open) {
      setTitulo(defaultTitle);
      setEspecialidade("");
    }
  }, [open, defaultTitle]);

  const options = useMemo(
    () => especialidadeOptions.map((e) => ({ value: e, label: e })),
    [especialidadeOptions],
  );

  const canSave = Boolean(especialidade) && !isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="neu-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Salvar na Biblioteca de Análises</DialogTitle>
          <DialogDescription>
            A análise e os {selectedCount} anúncio{selectedCount === 1 ? "" : "s"} selecionado
            {selectedCount === 1 ? "" : "s"} ficam visíveis para toda a equipe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="lib-titulo" className="text-xs font-medium">
              Título
            </Label>
            <Input
              id="lib-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
            />
            <p className="text-[11px] text-muted-foreground">
              É como a análise aparece na Biblioteca. Começa com o tema da busca.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lib-segmento" className="text-xs font-medium">
              Segmento principal
            </Label>
            <SearchableSelect
              value={especialidade}
              onValueChange={setEspecialidade}
              options={options}
              placeholder={loading ? "Carregando…" : "Escolha o segmento"}
              searchPlaceholder="Buscar segmento…"
              emptyText="Nenhum segmento encontrado."
              // Sem "Todos": a análise é de um segmento, não de todos.
              allOption={null}
              // Vive dentro de um Dialog: sem `modal` a trava de rolagem do diálogo impede rolar
              // a lista do popover.
              modal
              triggerClassName="w-full"
            />
            {!especialidade && (
              <p className="text-[11px] text-muted-foreground">
                Obrigatório — é por ele que a Biblioteca acha esta análise.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={() => onSave({ titulo: titulo.trim(), especialidade })} disabled={!canSave}>
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
