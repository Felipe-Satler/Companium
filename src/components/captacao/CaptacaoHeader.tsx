import { useNavigate } from "react-router-dom";
import { Facebook, Chrome, Target } from "lucide-react";

const tabs = [
  { label: "Metas", icon: Target, path: "/captacao/meta" },
  { label: "Meta Ads", icon: Facebook, path: "/captacao/meta-ads" },
  { label: "Google Ads", icon: Chrome, path: "/captacao/google-ads" },
];

interface CaptacaoHeaderProps {
  activeTab?: string;
}

export function CaptacaoHeader({ activeTab = "Meta Ads" }: CaptacaoHeaderProps) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div>
        <span className="neu-chip mb-1">Captação</span>
        <p className="text-sm text-muted-foreground">
          Visão interna da performance de mídia da Groohub
        </p>
      </div>

      {/* Tabs */}
      <div className="neu-inset inline-flex items-center gap-1 p-1.5 rounded-xl">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.label === activeTab;
          return (
            <button
              key={tab.label}
              onClick={() => tab.path && navigate(tab.path)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? "neu-button text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
