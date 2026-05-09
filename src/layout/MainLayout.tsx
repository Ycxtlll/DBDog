import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "../stores/uiStore";
import { useConnectionStore } from "../stores/connectionStore";
import { Sidebar } from "./Sidebar";
import { EditorArea } from "./EditorArea";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "../components/command-palette/CommandPalette";

export function MainLayout() {
  const { theme, language } = useUiStore();
  const loadConfigs = useConnectionStore((s) => s.loadConfigs);
  const { i18n } = useTranslation();

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      root.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <EditorArea />
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
