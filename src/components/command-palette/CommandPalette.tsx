import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useQueryStore } from "../../stores/queryStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { VirtualList } from "../virtual/VirtualList";

interface Command {
  id: string;
  title: string;
  category: string;
  action: () => void;
}

export function CommandPalette() {
  const { t } = useTranslation("common");
  const commandPaletteOpen = useUiStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setTheme = useUiStore((s) => s.setTheme);
  const configs = useConnectionStore((s) => s.configs);
  const activeId = useConnectionStore((s) => s.activeId);
  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const queryStore = useQueryStore.getState();
  const layoutStore = useLayoutStore.getState();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setCommandPaletteOpen]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setSearch("");
    }
  }, [commandPaletteOpen]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "query.new",
        title: t("newQuery"),
        category: "Query",
        action: () => queryStore.newTab(),
      },
      {
        id: "query.execute",
        title: t("executeQuery"),
        category: "Query",
        action: () => {
          if (activeId && queryStore.activeTabId) {
            queryStore.execute(activeId, queryStore.activeTabId);
          }
        },
      },
      {
        id: "query.format",
        title: t("formatSql"),
        category: "Query",
        action: () => {
          const tab = queryStore.tabs.find(
            (t) => t.id === queryStore.activeTabId,
          );
          if (tab) {
            import("sql-formatter").then(({ format }) => {
              queryStore.setTabSql(
                tab.id,
                format(tab.sql, { language: "mysql" }),
              );
            });
          }
        },
      },
      {
        id: "view.sidebar",
        title: t("toggleSidebar"),
        category: "View",
        action: () => layoutStore.toggleSidebar(),
      },
      {
        id: "theme.light",
        title: t("lightTheme"),
        category: "Settings",
        action: () => setTheme("light"),
      },
      {
        id: "theme.dark",
        title: t("darkTheme"),
        category: "Settings",
        action: () => setTheme("dark"),
      },
      {
        id: "theme.system",
        title: t("systemTheme"),
        category: "Settings",
        action: () => setTheme("system"),
      },
    ];

    configs.forEach((conn) => {
      list.push({
        id: `conn.connect.${conn.id}`,
        title: `${t("connect")} ${conn.name}`,
        category: "Connection",
        action: () => connect(conn.id),
      });
      if (activeId === conn.id) {
        list.push({
          id: `conn.disconnect.${conn.id}`,
          title: `${t("disconnect")} ${conn.name}`,
          category: "Connection",
          action: () => disconnect(conn.id),
        });
      }
    });

    return list;
  }, [
    t,
    configs,
    activeId,
    queryStore,
    layoutStore,
    setTheme,
    connect,
    disconnect,
  ]);
  // Note: queryStore and layoutStore are stable references from getState().
  // The actions read latest state at call time, so commands need not
  // recompute on every store change.

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return commands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [commands, search]);

  if (!commandPaletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        className="w-[600px] max-w-[90vw] bg-card border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          autoFocus
          className="w-full px-4 py-3 bg-transparent text-foreground outline-none border-b border-border"
          placeholder={t("searchCommand")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-[400px] overflow-hidden">
          <VirtualList
            items={filtered}
            rowHeight={40}
            renderItem={(cmd) => (
              <button
                className="w-full text-left px-4 py-2 hover:bg-accent flex items-center gap-3"
                onClick={() => {
                  cmd.action();
                  setCommandPaletteOpen(false);
                }}
              >
                <span className="text-xs text-muted-foreground w-24 shrink-0">
                  {cmd.category}
                </span>
                <span className="text-sm">{cmd.title}</span>
              </button>
            )}
          />
        </div>
      </div>
    </div>
  );
}
