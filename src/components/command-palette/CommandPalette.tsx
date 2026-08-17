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
  const layoutStore = useLayoutStore.getState();
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
      setSelectedIndex(0);
    }
  }, [commandPaletteOpen]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "query.new",
        title: t("newQuery"),
        category: "Query",
        action: () => useQueryStore.getState().newTab(),
      },
      {
        id: "query.execute",
        title: t("executeQuery"),
        category: "Query",
        action: () => {
          const qs = useQueryStore.getState();
          if (activeId && qs.activeTabId) {
            qs.execute(
              activeId,
              qs.activeTabId,
              useUiStore.getState().query.defaultLimit,
            );
          }
        },
      },
      {
        id: "query.format",
        title: t("formatSql"),
        category: "Query",
        action: () => {
          const qs = useQueryStore.getState();
          const tab = qs.tabs.find((qt) => qt.id === qs.activeTabId);
          if (tab) {
            import("sql-formatter").then(({ format }) => {
              qs.setTabSql(tab.id, format(tab.sql, { language: "mysql" }));
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
    layoutStore,
    setTheme,
    connect,
    disconnect,
  ]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return commands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [commands, search]);

  // Keep the selection valid as the filtered list shrinks/grows.
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const runCommand = (cmd: Command) => {
    cmd.action();
    setCommandPaletteOpen(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) runCommand(cmd);
    }
  };

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
          onKeyDown={handleInputKeyDown}
        />
        <div className="max-h-[400px] overflow-hidden" ref={listRef}>
          <VirtualList
            items={filtered}
            rowHeight={40}
            renderItem={(cmd, index) => (
              <button
                className={`w-full text-left px-4 py-2 flex items-center gap-3 ${
                  index === selectedIndex
                    ? "bg-accent"
                    : "hover:bg-accent"
                }`}
                onClick={() => runCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(index)}
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
