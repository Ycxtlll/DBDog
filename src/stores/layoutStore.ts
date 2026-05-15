import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarView: "connection" | "schema";
  drawer: { type: string | null; params?: Record<string, unknown> };
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarView: (view: "connection" | "schema") => void;
  openDrawer: (type: string, params?: Record<string, unknown>) => void;
  closeDrawer: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarVisible: true,
      sidebarWidth: 280,
      sidebarView: "connection",
      drawer: { type: null },
      toggleSidebar: () =>
        set((state) => ({ sidebarVisible: !state.sidebarVisible })),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      setSidebarView: (view) => set({ sidebarView: view }),
      openDrawer: (type, params) => set({ drawer: { type, params } }),
      closeDrawer: () => set({ drawer: { type: null } }),
    }),
    {
      name: "dbdog-layout",
      partialize: (state) => ({
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
      }),
    },
  ),
);
