import { useNavigate } from "react-router-dom";
import { Library, PenLine } from "lucide-react";

/**
 * Navegação de segundo nível, dentro do Composer.
 *
 * A mesma divisão da Mineração (`MineracaoSubnav`), pelo mesmo motivo: compor agora e reler o que
 * já foi composto são a mesma atividade em dois momentos, então dividem o espaço aqui dentro em vez
 * de virar duas abas no topo. O estilo é o daquela barra, de propósito — duas subnavegações com
 * caras diferentes dentro de Marketing pareceriam duas coisas diferentes.
 */
const tabs = [
  { label: "Nova Composição", icon: PenLine, path: "/marketing/composer" },
  // Tudo que a equipe já compôs, de todos os clientes, filtrável.
  { label: "Composições Salvas", icon: Library, path: "/marketing/composer/salvas" },
];

export type ComposerSubnavTab = (typeof tabs)[number]["label"];

export function ComposerSubnav({ activeTab }: { activeTab: ComposerSubnavTab }) {
  const navigate = useNavigate();

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.label === activeTab;
        return (
          <button
            key={tab.label}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => navigate(tab.path)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
