import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useUiStore } from "../stores/uiStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useLayoutStore } from "../stores/layoutStore";
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
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    // React to OS theme flips at runtime too — with theme === "system" the
    // app used to keep whatever was resolved at startup until relaunch.
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      const resolved = dark ? "dark" : "light";
      root.setAttribute("data-theme", resolved);
      useUiStore.getState().setResolvedTheme(resolved);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  // Ctrl/Cmd+B toggles the sidebar (matches editor conventions). Skip events
  // someone else already consumed — e.g. vim-mode Ctrl+B scrolls the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "b"
      ) {
        e.preventDefault();
        useLayoutStore.getState().toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <SidebarHandle />
        <EditorArea />
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}

/** Sidebar/editor divider: drag to resize (persisted via layoutStore),
 *  click to toggle collapse. A 3px movement threshold separates a click
 *  from the start of a drag; the click that follows a pointer-driven
 *  toggle is swallowed so the action doesn't fire twice. */
function SidebarHandle() {
  const { t } = useTranslation("common");
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ x: number; width: number; moved: boolean } | null>(
    null,
  );
  const suppressClickRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!sidebarVisible) return;
    dragState.current = { x: e.clientX, width: sidebarWidth, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    if (!st.moved && Math.abs(dx) < 3) return;
    st.moved = true;
    if (!dragging) setDragging(true);
    setSidebarWidth(Math.min(500, Math.max(200, st.width + dx)));
  };

  const onPointerUp = () => {
    const st = dragState.current;
    dragState.current = null;
    setDragging(false);
    if (st && !st.moved) {
      suppressClickRef.current = true;
      toggleSidebar();
    }
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!sidebarVisible) toggleSidebar();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={
        dragging
          ? undefined
          : sidebarVisible
            ? t("collapseSidebar")
            : t("expandSidebar")
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      className={`relative w-2 shrink-0 group select-none touch-none ${
        sidebarVisible ? "cursor-col-resize" : "cursor-pointer"
      }`}
    >
      <span
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all ${
          dragging
            ? "w-[3px] bg-primary"
            : "w-px bg-border group-hover:bg-primary/50 group-hover:w-[2px]"
        }`}
      />
      <span
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-4 h-9 rounded-md bg-card border border-border shadow-sm items-center justify-center text-muted-foreground hover:text-foreground ${
          dragging || !sidebarVisible ? "flex" : "hidden group-hover:flex"
        }`}
      >
        {sidebarVisible ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
      </span>
    </div>
  );
}
