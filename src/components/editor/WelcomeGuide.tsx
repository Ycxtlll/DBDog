import { useTranslation } from "react-i18next";
import {
  Database,
  MousePointerClick,
  Command,
  PanelLeft,
  PlusSquare,
} from "lucide-react";
import { useQueryStore } from "../../stores/queryStore";

/**
 * Shown in the editor area when a MySQL connection is active but no query
 * tab exists yet — replaces the big empty canvas with "how to start"
 * guidance plus the shortcuts that are easy to miss.
 */
export function WelcomeGuide() {
  const { t } = useTranslation("editor");
  const newTab = useQueryStore((s) => s.newTab);

  const hints: { icon: React.ReactNode; text: string; kbd?: string }[] = [
    {
      icon: <MousePointerClick size={14} />,
      text: t("welcomeBrowseHint"),
    },
    {
      icon: <Command size={14} />,
      text: t("welcomePaletteHint"),
      kbd: "Ctrl+K",
    },
    {
      icon: <PanelLeft size={14} />,
      text: t("welcomeSidebarHint"),
      kbd: "Ctrl+B",
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-1 select-none p-6">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
        <Database size={22} className="opacity-80" />
      </div>
      <div className="text-base font-medium text-foreground mb-1">
        {t("welcomeTitle")}
      </div>
      <div className="text-xs text-muted-foreground mb-5 max-w-[320px] text-center leading-relaxed">
        {t("welcomeDescription")}
      </div>
      <div className="flex flex-col gap-2.5 mb-6">
        {hints.map((hint) => (
          <div
            key={hint.text}
            className="flex items-center gap-2.5 text-xs text-muted-foreground"
          >
            <span className="w-6 h-6 rounded-md bg-muted flex items-center justify-center shrink-0">
              {hint.icon}
            </span>
            <span>{hint.text}</span>
            {hint.kbd && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono rounded-md border border-border bg-muted shrink-0">
                {hint.kbd}
              </span>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => newTab()}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <PlusSquare size={13} />
        {t("welcomeNewQuery")}
      </button>
    </div>
  );
}
