import { useState } from 'react';
import type { Conversation } from '@/chatbot/react/conversationsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { X, Plus, MoreVertical, Pencil, Trash2 } from 'lucide-react';

export function ConversationList({
    conversations, activeId, onSwitch, onNew, onClose, onRename, onDelete, className = '',
}: {
    conversations: Conversation[];
    activeId: string | null;
    onSwitch: (id: string) => void;
    onNew: () => void;
    onClose: () => void;
    onRename: (id: string, newTitle: string) => void;
    onDelete: (id: string) => void;
    className?: string;
}) {
    const [ renaming, setRenaming ] = useState<Conversation | null>(null);
    const [ renameValue, setRenameValue ] = useState('');
    const [ deleting, setDeleting ] = useState<Conversation | null>(null);

    const commitRename = () => {
        if (renaming && renameValue.trim()) onRename(renaming.id, renameValue.trim());
        setRenaming(null);
    };

    return (
        <aside className={`flex flex-col bg-transparent ${className}`}>
      {/* Topo: botão "Nova conversa" em destaque (padrão Claude) + fechar (mobile). */}
      <div className="flex items-center gap-2 p-3">
        <Button
          onClick={onNew}
          className="h-9 flex-1 justify-start gap-2 rounded-lg text-sm font-medium shadow-sm"
        >
          <Plus className="h-4 w-4" /> Nova conversa
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 lg:hidden" onClick={onClose}
          aria-label="Fechar painel" title="Fechar">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Rótulo da seção — deixa claro que abaixo vêm as conversas salvas. */}
      <div className="px-4 pb-1 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Conversas
        </span>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">Nenhuma conversa ainda.</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => onSwitch(c.id)}
            className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
              c.id === activeId ? 'bg-muted font-medium' : 'hover:bg-muted/60'
            }`}
          >
            <span className="flex-1 truncate" title={c.title}>{c.title || 'Nova conversa'}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <button type="button" aria-label="Opções da conversa"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => { setRenaming(c); setRenameValue(c.title); }}>
                  <Pencil className="mr-2 h-4 w-4" /> Renomear
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(c)}>
                  <Trash2 className="mr-2 h-4 w-4" /> Apagar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renomear conversa</DialogTitle></DialogHeader>
          <Input value={renameValue} autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); }} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancelar</Button>
            <Button onClick={commitRename} disabled={!renameValue.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar “{deleting?.title || 'conversa'}”?</AlertDialogTitle>
            <AlertDialogDescription>
              A conversa e todo o histórico dela serão removidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleting) onDelete(deleting.id); setDeleting(null); }}>
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
    )
}