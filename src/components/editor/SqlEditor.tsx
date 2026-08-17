import CodeMirror from "@uiw/react-codemirror";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import type { ViewUpdate } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { sql as sqlExtension, MySQL } from "@codemirror/lang-sql";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { keymap } from "@codemirror/view";
import { useTranslation } from "react-i18next";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useUiStore } from "../../stores/uiStore";

export interface SqlEditorHandle {
  getSelection(): { hasSelection: boolean; selectedSql: string };
}

interface ContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

interface SqlEditorProps {
  tabId: string;
  sql: string;
  onChange: (sql: string) => void;
  onExecuteSelection?: (selectedSql: string) => void;
  onExecuteAll?: () => void;
  onSelectionChange?: (hasSelection: boolean) => void;
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(
    { sql, onChange, onExecuteSelection, onExecuteAll, onSelectionChange },
    ref,
  ) {
    const { t } = useTranslation("editor");
    const { theme, editor: editorSettings } = useUiStore();
    const resolvedTheme = useUiStore((s) => s.resolvedTheme);
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const prevHasSelRef = useRef(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
      null,
    );

    useImperativeHandle(ref, () => ({
      getSelection() {
        const view = cmRef.current?.view;
        if (!view) return { hasSelection: false, selectedSql: "" };
        const { from, to } = view.state.selection.main;
        const selectedSql = view.state.sliceDoc(from, to);
        return { hasSelection: from !== to, selectedSql };
      },
    }));

    useEffect(() => {
      if (!contextMenu) return;
      const close = () => setContextMenu(null);
      window.addEventListener("click", close);
      return () => window.removeEventListener("click", close);
    }, [contextMenu]);

    const handleUpdate = useCallback(
      (vu: ViewUpdate) => {
        if (!onSelectionChange) return;
        const { from, to } = vu.state.selection.main;
        const hasSelection = from !== to;
        if (hasSelection !== prevHasSelRef.current) {
          prevHasSelRef.current = hasSelection;
          onSelectionChange(hasSelection);
        }
      },
      [onSelectionChange],
    );

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const view = cmRef.current?.view;
      const { from, to } = view?.state.selection.main ?? {
        from: 0,
        to: 0,
      };
      setContextMenu({
        x: Math.min(e.clientX, window.innerWidth - 180),
        y: Math.min(e.clientY, window.innerHeight - 220),
        hasSelection: from !== to,
      });
    }, []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const handleExecuteSelection = useCallback(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      if (from !== to) {
        onExecuteSelection?.(view.state.sliceDoc(from, to));
      }
      closeContextMenu();
    }, [onExecuteSelection, closeContextMenu]);

    const handleCopy = useCallback(async () => {
      const view = cmRef.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      if (from !== to) {
        navigator.clipboard
          .writeText(view.state.sliceDoc(from, to))
          .catch(() => {});
      }
      closeContextMenu();
    }, [closeContextMenu]);

    const handleCut = useCallback(async () => {
      const view = cmRef.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      if (from !== to) {
        navigator.clipboard
          .writeText(view.state.sliceDoc(from, to))
          .catch(() => {});
        view.dispatch({ changes: { from, to } });
      }
      closeContextMenu();
    }, [closeContextMenu]);

    const handlePaste = useCallback(async () => {
      const view = cmRef.current?.view;
      if (!view) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          view.dispatch({
            changes: {
              from: view.state.selection.main.head,
              insert: text,
            },
          });
        }
      } catch {
        // clipboard read denied
      }
      closeContextMenu();
    }, [closeContextMenu]);

    const handleSelectAll = useCallback(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        selection: { anchor: 0, head: view.state.doc.length },
      });
      closeContextMenu();
    }, [closeContextMenu]);

    const handleFormat = useCallback(async () => {
      try {
        const { format } = await import("sql-formatter");
        onChange(format(sql, { language: "mysql" }));
      } catch (err) {
        console.error("Format failed:", err);
      }
      closeContextMenu();
    }, [sql, onChange, closeContextMenu]);

    const editorTheme = useMemo(() => {
      if (theme === "dark") return vscodeDark;
      if (theme === "light") return vscodeLight;
      return resolvedTheme === "dark" ? vscodeDark : vscodeLight;
    }, [theme, resolvedTheme]);

    const extensions = useMemo(() => {
      const base: import("@codemirror/state").Extension[] = [
        sqlExtension({ dialect: MySQL }),
      ];
      if (onExecuteSelection || onExecuteAll) {
        base.push(
          Prec.highest(
            keymap.of([
              {
                // Mod-Enter: execute selection if present, otherwise the
                // whole editor (documented in docs/features.md).
                key: "Mod-Enter",
                run: (view) => {
                  const { from, to } = view.state.selection.main;
                  if (from !== to && onExecuteSelection) {
                    onExecuteSelection(view.state.sliceDoc(from, to));
                  } else {
                    onExecuteAll?.();
                  }
                  return true;
                },
              },
              {
                key: "Mod-Shift-Enter",
                run: (view) => {
                  const { from, to } = view.state.selection.main;
                  if (from !== to && onExecuteSelection) {
                    onExecuteSelection(view.state.sliceDoc(from, to));
                    return true;
                  }
                  return false;
                },
              },
              {
                key: "Mod-Shift-f",
                preventDefault: true,
                run: () => {
                  handleFormat();
                  return true;
                },
              },
            ]),
          ),
        );
      }
      return base;
    }, [onExecuteSelection, onExecuteAll, handleFormat]);

    const hasSelection = contextMenu?.hasSelection ?? false;

    return (
      <div className="h-full w-full relative" onContextMenu={handleContextMenu}>
        <CodeMirror
          ref={cmRef}
          value={sql}
          height="100%"
          theme={editorTheme}
          extensions={extensions}
          onChange={onChange}
          onUpdate={handleUpdate}
          basicSetup={{
            tabSize: editorSettings.tabSize,
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            foldGutter: false,
          }}
          style={{ fontSize: `${editorSettings.fontSize}px` }}
        />
        {contextMenu && (
          <div
            className="fixed z-[60] min-w-[170px] py-1 bg-card border border-border rounded-lg shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {hasSelection && (
              <>
                <button
                  className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left flex items-center justify-between"
                  onClick={handleExecuteSelection}
                >
                  <span>{t("executeSelection")}</span>
                  <span className="text-[10px] text-muted-foreground ml-4 shrink-0">
                    Ctrl+Enter
                  </span>
                </button>
                <div className="h-px bg-border mx-2 my-1" />
              </>
            )}
            <button
              className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left disabled:opacity-40"
              disabled={!hasSelection}
              onClick={handleCut}
            >
              {t("cut")}
            </button>
            <button
              className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left disabled:opacity-40"
              disabled={!hasSelection}
              onClick={handleCopy}
            >
              {t("copy")}
            </button>
            <button
              className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left"
              onClick={handlePaste}
            >
              {t("paste")}
            </button>
            <div className="h-px bg-border mx-2 my-1" />
            <button
              className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left"
              onClick={handleFormat}
            >
              {t("format")}
            </button>
            <button
              className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left"
              onClick={handleSelectAll}
            >
              {t("selectAll")}
            </button>
          </div>
        )}
      </div>
    );
  },
);
