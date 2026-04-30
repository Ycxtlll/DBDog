import { create } from 'zustand';

type SidebarPanel = 'connections' | 'history' | 'bookmarks' | 'health' | 'er' | 'explain' | 'diff' | 'none';

interface UIState {
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  isSidebarOpen: boolean;
  isCommandPaletteOpen: boolean;
  theme: 'light' | 'dark';
  language: 'en' | 'zh';

  setSidebarPanel: (panel: SidebarPanel) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setLanguage: (lang: 'en' | 'zh') => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarPanel: 'connections',
  sidebarWidth: 280,
  isSidebarOpen: true,
  isCommandPaletteOpen: false,
  theme: (localStorage.getItem('dbdog-theme') as 'light' | 'dark') || 'dark',
  language: (localStorage.getItem('dbdog-lang') as 'en' | 'zh') || 'en',

  setSidebarPanel: (panel) =>
    set((s) => ({
      sidebarPanel: panel,
      isSidebarOpen: panel === 'none' ? false : s.isSidebarOpen || true,
    })),

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),

  setTheme: (theme) => {
    localStorage.setItem('dbdog-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },

  toggleTheme: () => {
    const current = get().theme;
    get().setTheme(current === 'dark' ? 'light' : 'dark');
  },

  setLanguage: (lang) => {
    localStorage.setItem('dbdog-lang', lang);
    set({ language: lang });
  },
}));
