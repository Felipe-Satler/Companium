import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Pencil, Plus, RotateCcw, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CHAVE_EQUIPES_ADMIN,
  arquivarEquipe,
  atribuirEquipe,
  criarEquipe,
  excluirEquipe,
  reativarEquipe,
  renomearEquipe,
  useEquipesAdmin,
  type EquipeAdmin,
} from "@/hooks/useEquipes";

/**
 * Cadastro de equipes. A atribuição de cada pessoa fica na linha dela, na aba Usuários.
 * Equipe que já teve membro não é excluída — é arquivada, para não sumir das comparações de
 * períodos passados em Uso do Companium.
 */
export function AdminEquipes({ emailDe }: { emailDe: (id: string) => string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useEquipesAdmin(true);
  const [nome, setNome] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: CHAVE_EQUIPES_ADMIN });
    void qc.invalidateQueries({ queryKey: ["uso", "equipes"] });
  };

  const executar = async (acao: () => Promise<void>, ok: string) => {
    setSalvando(true);
    try {
      await acao();
      toast.success(ok);
      recarregar();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    if (await executar(() => criarEquipe(nome), `Equipe "${nome.trim()}" criada.`)) setNome("");
  };

  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const ativas = data.equipes.filter((e) => !e.arquivada_em);
  const arquivadas = data.equipes.filter((e) => e.arquivada_em);
  const membrosDe = (id: string) => [...data.atual].filter(([, eq]) => eq === id).map(([u]) => u);

  return (
    <div className="space-y-4">
      <form onSubmit={criar} className="neu-card flex flex-wrap items-center gap-2 p-4">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={60}
          placeholder="Nome da nova equipe (ex.: Tráfego, Atendimento)"
          className="h-9 max-w-sm"
          aria-label="Nome da nova equipe"
        />
        <Button type="submit" size="sm" disabled={salvando || !nome.trim()} className="gap-1">
          <Plus className="size-4" aria-hidden="true" />
          Criar equipe
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          Para colocar alguém numa equipe, use o seletor "Equipe" na linha da pessoa, na aba Usuários. Só a equipe interna
          entra em equipes.
        </p>
      </form>

      {!ativas.length ? (
        <p className="neu-card p-6 text-sm text-muted-foreground">Nenhuma equipe cadastrada ainda.</p>
      ) : (
        <ul className="space-y-2">
          {ativas.map((e) => (
            <LinhaEquipe
              key={e.id}
              equipe={e}
              membros={membrosDe(e.id).map(emailDe)}
              temHistorico={data.comHistorico.has(e.id)}
              salvando={salvando}
              executar={executar}
            />
          ))}
        </ul>
      )}

      {arquivadas.length > 0 && (
        <details className="neu-card p-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Arquivadas ({arquivadas.length})</summary>
          <ul className="mt-3 space-y-2">
            {arquivadas.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{e.nome}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  disabled={salvando}
                  onClick={() => void executar(() => reativarEquipe(e.id), `Equipe "${e.nome}" reativada.`)}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Reativar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function LinhaEquipe({
  equipe,
  membros,
  temHistorico,
  salvando,
  executar,
}: {
  equipe: EquipeAdmin;
  membros: string[];
  temHistorico: boolean;
  salvando: boolean;
  executar: (acao: () => Promise<void>, ok: string) => Promise<boolean>;
}) {
  const [editando, setEditando] = React.useState(false);
  const [nome, setNome] = React.useState(equipe.nome);

  const salvar = async () => {
    if (!nome.trim() || nome.trim() === equipe.nome) return setEditando(false);
    if (await executar(() => renomearEquipe(equipe.id, nome), "Equipe renomeada.")) setEditando(false);
  };

  return (
    <li className="neu-card flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        {editando ? (
          <div className="flex items-center gap-1">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void salvar();
                if (e.key === "Escape") setEditando(false);
              }}
              maxLength={60}
              className="h-8 max-w-xs"
              aria-label="Novo nome da equipe"
              autoFocus
            />
            <Button size="icon" variant="ghost" className="size-8" onClick={() => void salvar()} aria-label="Salvar nome">
              <Check className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditando(false)} aria-label="Cancelar">
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <p className="font-semibold text-foreground">{equipe.nome}</p>
        )}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {membros.length ? `${membros.length} ${membros.length === 1 ? "membro" : "membros"}: ${membros.join(", ")}` : "Sem membros no momento"}
        </p>
      </div>
      {!editando && (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setEditando(true)} disabled={salvando}>
            <Pencil className="size-3.5" aria-hidden="true" />
            Renomear
          </Button>
          {temHistorico ? (
            <ConfirmActionDialog
              title="Arquivar equipe"
              description={
                <>
                  A equipe <span className="font-semibold text-foreground">{equipe.nome}</span> fica sem membros e some da
                  atribuição. O uso passado dela continua nas comparações.
                </>
              }
              confirmLabel="Arquivar"
              onConfirm={() => void executar(() => arquivarEquipe(equipe.id), `Equipe "${equipe.nome}" arquivada.`)}
              tooltip="Arquivar: tira todos os membros, mas guarda o histórico."
              trigger={
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={salvando}>
                  <Archive className="size-3.5" aria-hidden="true" />
                  Arquivar
                </Button>
              }
            />
          ) : (
            <ConfirmActionDialog
              title="Excluir equipe"
              description={
                <>
                  Excluir a equipe <span className="font-semibold text-foreground">{equipe.nome}</span>? Ela nunca teve
                  membros, então nada se perde.
                </>
              }
              confirmLabel="Excluir"
              onConfirm={() => void executar(() => excluirEquipe(equipe.id), `Equipe "${equipe.nome}" excluída.`)}
              tooltip="Excluir a equipe (ela nunca teve membros)."
              trigger={
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={salvando}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Excluir
                </Button>
              }
            />
          )}
        </div>
      )}
    </li>
  );
}

const SEM_EQUIPE = "__sem__";

/** Seletor "Equipe" na linha do usuário (aba Usuários). Trocar guarda o histórico (equipe da época). */
export function SeletorEquipe({ userId, disabled }: { userId: string; disabled?: boolean }) {
  const qc = useQueryClient();
  const { data } = useEquipesAdmin(true);
  const [salvando, setSalvando] = React.useState(false);
  if (!data) return null;
  const atual = data.atual.get(userId) ?? SEM_EQUIPE;
  const ativas = data.equipes.filter((e) => !e.arquivada_em);

  const trocar = async (valor: string) => {
    const destino = valor === SEM_EQUIPE ? null : valor;
    setSalvando(true);
    try {
      await atribuirEquipe(userId, destino);
      toast.success(destino ? `Equipe alterada para "${ativas.find((e) => e.id === destino)?.nome}".` : "Usuário tirado da equipe.");
      void qc.invalidateQueries({ queryKey: CHAVE_EQUIPES_ADMIN });
      void qc.invalidateQueries({ queryKey: ["uso", "equipes"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Select value={atual} onValueChange={(v) => void trocar(v)} disabled={disabled || salvando}>
      <SelectTrigger className="h-7 w-44 text-xs" aria-label="Equipe">
        <Users className="mr-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SEM_EQUIPE} className="text-xs">Sem equipe</SelectItem>
        {ativas.map((e) => (
          <SelectItem key={e.id} value={e.id} className="text-xs">
            {e.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
