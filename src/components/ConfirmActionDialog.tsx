import { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ConfirmVariant = "danger" | "primary";

interface ConfirmActionDialogProps {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: ConfirmVariant;
  /** Texto opcional de tooltip exibido ao passar o mouse sobre o botão de gatilho. */
  tooltip?: string;
}

export function ConfirmActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
  variant = "danger",
  tooltip,
}: ConfirmActionDialogProps) {
  const actionClass = variant === "primary" ? "neu-button-primary" : "neu-button-danger";

  return (
    <AlertDialog>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-center">{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      )}
      <AlertDialogContent className="neu-dialog sm:max-w-xl p-8">
        <AlertDialogHeader className="text-center sm:text-center items-center">
          <AlertDialogTitle className="text-center">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center gap-2">
          <AlertDialogCancel className="neu-button mt-0">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={actionClass}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
