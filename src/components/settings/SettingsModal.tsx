import { useTranslation } from "react-i18next";
import { X, Monitor, Sun, Moon } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t } = useTranslation(["settings", "common"]);
  const { theme, language, setTheme, setLanguage } = useUiStore();

  if (!isOpen) return null;

  const themes: { key: "system" | "light" | "dark"; icon: React.ReactNode; label: string }[] = [
    { key: "system", icon: <Monitor size={14} />, label: t("common:systemTheme") },
    { key: "light", icon: <Sun size={14} />, label: t("common:lightTheme") },
    { key: "dark", icon: <Moon size={14} />, label: t("common:darkTheme") },
  ];

  const languages: { key: "zh" | "en"; label: string }[] = [
    { key: "zh", label: t("chinese") },
    { key: "en", label: t("english") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-[360px] max-w-[90vw] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted">
          <h3 className="text-base font-semibold text-foreground">
            {t("settings:settings")}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("common:cancel")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-6">
          {/* Theme */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings:theme")}
            </label>
            <div className="flex gap-2">
              {themes.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setTheme(item.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md border transition-colors ${
                    theme === item.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-accent"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings:language")}
            </label>
            <div className="flex gap-2">
              {languages.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setLanguage(item.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md border transition-colors ${
                    language === item.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-accent"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
