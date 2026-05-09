import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppSettings } from "../types";

interface UiState extends AppSettings {
  commandPaletteOpen: boolean;
  setTheme: (theme: AppSettings["theme"]) => void;
  setLanguage: (language: AppSettings["language"]) => void;
  updateEditor: (editor: Partial<AppSettings["editor"]>) => void;
  updateQuery: (query: Partial<AppSettings["query"]>) => void;
  updatePerformance: (perf: Partial<AppSettings["performance"]>) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

const defaultSettings: AppSettings = {
  theme: "system",
  language: "en",
  editor: {
    tabSize: 2,
    fontSize: 14,
    vimMode: false,
    autoComplete: true,
    wordWrap: false,
  },
  query: {
    defaultLimit: 1000,
    cancelOnNavigate: true,
  },
  performance: {
    connectionTimeoutSecs: 30,
    schemaCacheTtlSecs: 300,
    maxPoolSize: 10,
  },
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      commandPaletteOpen: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      updateEditor: (editor) =>
        set((state) => ({ editor: { ...state.editor, ...editor } })),
      updateQuery: (query) =>
        set((state) => ({ query: { ...state.query, ...query } })),
      updatePerformance: (perf) =>
        set((state) => ({ performance: { ...state.performance, ...perf } })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: "dbdog-ui",
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        editor: state.editor,
        query: state.query,
        performance: state.performance,
      }),
    },
  ),
);
