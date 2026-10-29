import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ClientesHeader } from "@/components/clientes/ClientesHeader";
import { CronogramaEditor } from "@/components/projetos/CronogramaEditor";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCronogramaClients,
  useCronogramaBoard,
  saveBoard,
  deleteBoard,
  fetchSavedClients,
} from "@/hooks/useCronograma";

const NOVO = "__novo__"; // sentinela: rascunho "Cliente novo" (não salvo)

export default function ProjetosCronograma() {
  // Toda a equipe Groohub (usuário interno) edita o cronograma. Usuário-cliente só chega aqui se
  // tiver o papel cronograma_viewer (CronogramaRoute libera) e, mesmo então, é SOMENTE LEITURA.
  // canEdit libera edição + salvar/remover.
  const { clientUser } = useAuth();
  const canEdit = !clientUser;
  const { clients: dbClients, error: clientsError } = useCronogramaClients();
  const [savedClients, setSavedClients] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>(NOVO);

  const client = selected === NOVO ? null : selected;
  const { board, setBoard, onChange, saving, error: boardError } = useCronogramaBoard(client);

  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");

  // Clientes que já têm cronograma salvo (para o seletor + botão remover).
  useEffect(() => {
    fetchSavedClients()
      .then(setSavedClients)
      .catch(() => setSavedClients([]));
  }, []);

  useEffect(() => {
    if (clientsError) {
      toast.error("Clientes do banco indisponíveis", { description: clientsError });
    }
  }, [clientsError]);

  useEffect(() => {
    if (boardError) {
      toast.error("Falha ao sincronizar o cronograma", { description: boardError });
    }
  }, [boardError]);

  // Opções do seletor: união clientes do banco + clientes com cronograma salvo.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of [...dbClients, ...savedClients]) {
      const k = name.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(name);
      }
    }
    return out
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((v) => ({ value: v, label: v }));
  }, [dbClients, savedClients]);

  const isSaved = selected !== NOVO && savedClients.some((c) => c === selected);

  const handleSaveClient = async () => {
    const name = newName.trim();
    if (!name) return;
    if (options.some((o) => o.value.toLowerCase() === name.toLowerCase()) && name !== selected) {
      // Já existe no banco/salvos — apenas seleciona (evita duplicar).
      if (savedClients.some((c) => c.toLowerCase() === name.toLowerCase())) {
        toast.error("Cliente já existe", { description: name });
        return;
      }
    }
    try {
      await saveBoard(name, board);
      setSavedClients((prev) => (prev.includes(name) ? prev : [...prev, name]));
      setSelected(name);
      setNewName("");
      setSaveOpen(false);
      toast.success("Cliente salvo", { description: name });
    } catch (e: any) {
      toast.error("Não foi possível salvar o cliente", { description: e?.message || String(e) });
    }
  };

  const handleRemoveClient = async () => {
    if (selected === NOVO) return;
    const target = selected;
    try {
      await deleteBoard(target);
      setSavedClients((prev) => prev.filter((c) => c !== target));
      setSelected(NOVO);
      setBoard({ months: [], rows: [] });
      toast.success("Cronograma removido", { description: target });
    } catch (e: any) {
      toast.error("Não foi possível remover", { description: e?.message || String(e) });
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6">
        <div className="space-y-6">
          {/* Barra de abas de Clientes (CRM/Meta/Google/Cronograma) — mesma do resto
              da seção. A aba Cronograma é filtrada p/ usuário-cliente dentro do header. */}
          <ClientesHeader activeTab="Cronograma" />
          <div className="neu-panel flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Cronograma</h1>
              <p className="text-sm text-muted-foreground">
                Cronograma dos marcos de trabalho por cliente
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <SearchableSelect
                value={selected}
                onValueChange={setSelected}
                options={options}
                allOption={{ value: NOVO, label: "Cliente novo" }}
                placeholder="Selecione o cliente"
                searchPlaceholder="Buscar cliente..."
                triggerClassName="w-[240px]"
              />
              {canEdit && (
                <Button
                  type="button"
                  className="neu-button gap-2 border-0"
                  variant="outline"
                  onClick={() => {
                    setNewName(selected === NOVO ? "" : selected);
                    setSaveOpen(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Salvar cliente
                  {saving && <span className="ml-1 text-[11px] text-muted-foreground">salvando…</span>}
                </Button>
              )}
              {canEdit && isSaved && (
                <ConfirmActionDialog
                  trigger={
                    <Button type="button" variant="ghost" className="neu-button gap-2 text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                      Remover cliente
                    </Button>
                  }
                  title={`Remover cronograma de "${selected}"?`}
                  description="Esta ação apaga o cronograma salvo deste cliente e não pode ser desfeita."
                  confirmLabel="Remover"
                  onConfirm={handleRemoveClient}
                />
              )}
            </div>
          </div>

          <CronogramaEditor
            board={board}
            onChange={onChange}
            clientLabel={selected === NOVO ? "cliente-novo" : selected}
            canEdit={canEdit}
          />
        </div>
      </div>

      {/* Diálogo: salvar cliente */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="neu-dialog">
          <DialogHeader>
            <DialogTitle>Salvar cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="novo-cliente" className="text-xs text-muted-foreground">
              Nome do cliente
            </Label>
            <Input
              id="novo-cliente"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveClient()}
              placeholder="Ex.: Clínica Exemplo"
              className="neu-inset border-0"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              O cronograma atual será salvo para este cliente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="neu-button" onClick={() => setSaveOpen(false)}>
              Cancelar
            </Button>
            <Button className="neu-button-primary" onClick={handleSaveClient}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
