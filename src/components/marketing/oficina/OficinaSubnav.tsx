import { useNavigate } from "react-router-dom";
import { Library, Palette } from "lucide-react";

/**
 * Navegação de segundo nível, dentro da Oficina de Artes.
 *
 * A mesma divisão — e a mesma cara — do `ComposerSubnav`: fazer uma arte agora e reencontrar as que
 * já foram feitas são a mesma atividade em dois momentos.
 */
const tabs = [
  { label: "Nova arte", icon: Palette, path: "/marketing/oficina" },
  // Todas as artes da carteira, com filtro por cliente e especialidade, e os mockups.
  { label: "Artes Salvas", icon: Library, path: "/marketing/oficina/salvas" },
];

export type OficinaSubnavTab = (typeof tabs)[number]["label"];

export function OficinaSubnav({ activeTab }: { activeTab: OficinaSubnavTab }) {
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
