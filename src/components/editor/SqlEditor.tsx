import CodeMirror from "@uiw/react-codemirror";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import type { ViewUpdate } from "@codemirror/view";
import { Prec, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  sql as sqlExtension,
  MySQL,
  schemaCompletionSource,
  keywordCompletionSource,
  type SQLConfig,
} from "@codemirror/lang-sql";
import {
  autocompletion,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { useTranslation } from "react-i18next";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useQueryStore } from "../../stores/queryStore";
import * as schemaService from "../../services/schemaService";
import { statementRangeAt } from "../../lib/sql";
import type { CompletionSchema } from "../../types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

/** database → table → columns snapshot for the active connection. */
const SCHEMA_TTL = 5 * 60_000;
const completionSchemaCache = new Map<
  string,
  { schema: CompletionSchema; fetchedAt: number }
>();

/**
 * Extensions for the sql compartment: syntax highlighting always, plus the
 * completion setup when autoComplete is on. The completion is a single
 * override source so nothing else in basicSetup interferes:
 *   1. `USE <db>` — completes database names;
 *   2. otherwise lang-sql's schema source (db/table/column, dot-aware)
 *      merged with the dialect keyword source.
 *
 * `defaultSchema` is required for bare `FROM <table>` completion: without
 * it, lang-sql only completes tables after an explicit `db.` prefix
 * ((defaultSchema || top).addCompletions(tables) in its source).
 */
function makeSqlSetup(
  schema: CompletionSchema | null,
  autoComplete: boolean,
  defaultSchema?: string,
): Extension[] {
  const highlight = sqlExtension({ dialect: MySQL });
  if (!autoComplete) return [highlight];

  const config: SQLConfig = {
    dialect: MySQL,
    upperCaseKeywords: true,
    schema: schema ?? {},
    defaultSchema: defaultSchema || undefined,
  };
  const schemaSource = schemaCompletionSource(config);
  const keywordSource = keywordCompletionSource(MySQL, true);

  const useDbSource: CompletionSource = (ctx: CompletionContext) => {
    if (!schema) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const m = /\buse\s+(?:`([^`]*)|([A-Za-z0-9_$]*))$/i.exec(before);
    if (!m) return null;
    const ident = m[1] ?? m[2] ?? "";
    return {
      from: ctx.pos - ident.length,
      options: Object.keys(schema).map((name) => ({
        label: name,
        type: "namespace",
        detail: "database",
      })),
      validFor: /^[A-Za-z0-9_$`]*$/,
    };
  };

  const combined: CompletionSource = async (ctx) => {
    const useResult = useDbSource(ctx);
    if (useResult) return useResult;
    const [schemaResult, keywordResult] = await Promise.all([
      schemaSource(ctx),
      keywordSource(ctx),
    ]);
    if (!schemaResult && !keywordResult) return null;
    const base = schemaResult ?? keywordResult!;
    const seen = new Set<string>();
    const options = [
      ...(schemaResult?.options ?? []),
      ...(keywordResult?.options ?? []),
    ].filter((o) => (seen.has(o.label) ? false : (seen.add(o.label), true)));
    return { from: base.from, options, validFor: base.validFor };
  };

  return [
    highlight,
    autocompletion({ override: [combined], activateOnTyping: true }),
  ];
}

export interface SqlEditorHandle {
  getSelection(): { hasSelection: boolean; selectedSql: string };
  /** The statement containing the cursor, or null when the doc is empty. */
  getStatementAtCursor(): string | null;
}

interface ContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

interface SqlEditorProps {
  tabId: string;
  sql: string;
  placeholder?: string;
  onChange: (sql: string) => void;
  onExecuteSelection?: (selectedSql: string) => void;
  onExecuteAll?: () => void;
  /** Execute the single statement containing the cursor. */
  onExecuteStatement?: (statementSql: string) => void;
  onSelectionChange?: (hasSelection: boolean) => void;
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(
    {
      tabId,
      sql,
      placeholder,
      onChange,
      onExecuteSelection,
      onExecuteAll,
      onExecuteStatement,
      onSelectionChange,
    },
    ref,
  ) {
    const { t } = useTranslation("editor");
    const { theme, editor: editorSettings } = useUiStore();
    const resolvedTheme = useUiStore((s) => s.resolvedTheme);
    const activeConnectionId = useConnectionStore((s) => s.activeId);
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const prevHasSelRef = useRef(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
      null,
    );

    // SQL completion: the language + autocompletion setup lives in a
    // compartment so the schema can be hot-swapped without touching the
    // extensions array (whose identity must stay stable — see handlersRef).
    const autoComplete = editorSettings.autoComplete;
    const autoCompleteRef = useRef(autoComplete);
    autoCompleteRef.current = autoComplete;
    const sqlCompartment = useMemo(() => new Compartment(), []);

    // Which database plain `FROM <table>` completes from: the tab's current
    // database (follows the tree selection / USE statements), falling back
    // to the connection's configured default.
    const selectedDatabase = useQueryStore(
      (s) => s.tabs.find((t) => t.id === tabId)?.selectedDatabase,
    );
    const configDatabase = useConnectionStore((s) =>
      s.configs.find((c) => c.id === s.activeId)?.database,
    );
    const defaultDb = selectedDatabase ?? configDatabase;
    const defaultDbRef = useRef(defaultDb);
    defaultDbRef.current = defaultDb;

    // Holds the extension set currently installed in the compartment.
    // @uiw's basicSetup/onChange props get new object identities each render,
    // which triggers a full StateEffect.reconfigure and RESETS compartments
    // to whatever `sqlCompartment.of(...)` declares — seeding from this ref
    // makes those resets self-healing instead of dropping the loaded schema.
    const currentSetupRef = useRef<Extension[] | null>(null);

    const applySqlSetup = useCallback(
      (schema: CompletionSchema | null) => {
        const view = cmRef.current?.view;
        // When no database is selected anywhere, a server with exactly one
        // user database can safely default to it — otherwise bare
        // `FROM <table>` completes nothing but database names.
        const fallback =
          schema && Object.keys(schema).length === 1
            ? Object.keys(schema)[0]
            : undefined;
        const setup = makeSqlSetup(
          schema,
          autoCompleteRef.current,
          defaultDbRef.current ?? fallback,
        );
        currentSetupRef.current = setup;
        view?.dispatch({
          effects: sqlCompartment.reconfigure(setup),
        });
      },
      [sqlCompartment],
    );

    const loadCompletionSchema = useCallback(
      async (connId: string, force = false) => {
        const cached = completionSchemaCache.get(connId);
        if (!force && cached && Date.now() - cached.fetchedAt < SCHEMA_TTL) {
          applySqlSetup(cached.schema);
          return;
        }
        try {
          const schema = await schemaService.getCompletionSchema(connId);
          completionSchemaCache.set(connId, { schema, fetchedAt: Date.now() });
          applySqlSetup(schema);
        } catch (err) {
          // Completion silently degrades to keywords-only.
          console.error("Failed to load completion schema:", err);
          applySqlSetup(null);
        }
      },
      [applySqlSetup],
    );

    useEffect(() => {
      if (activeConnectionId && autoComplete) {
        loadCompletionSchema(activeConnectionId);
      } else {
        applySqlSetup(null);
      }
      // defaultDb re-runs this so `FROM <table>` follows the tree/USE
      // selection — the cached schema makes it instant.
    }, [
      activeConnectionId,
      autoComplete,
      defaultDb,
      loadCompletionSchema,
      applySqlSetup,
    ]);

    // DDL applied elsewhere (visual table designer) invalidates the snapshot.
    useEffect(() => {
      if (!activeConnectionId) return;
      const handler = () => loadCompletionSchema(activeConnectionId, true);
      window.addEventListener("dbdog-schema-changed", handler);
      return () => window.removeEventListener("dbdog-schema-changed", handler);
    }, [activeConnectionId, loadCompletionSchema]);

    useImperativeHandle(ref, () => ({
      getSelection() {
        const view = cmRef.current?.view;
        if (!view) return { hasSelection: false, selectedSql: "" };
        const { from, to } = view.state.selection.main;
        const selectedSql = view.state.sliceDoc(from, to);
        return { hasSelection: from !== to, selectedSql };
      },
      getStatementAtCursor() {
        const view = cmRef.current?.view;
        if (!view) return null;
        return (
          statementRangeAt(
            view.state.doc.toString(),
            view.state.selection.main.head,
          )?.text ?? null
        );
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

    // The keymap reads callbacks through a ref so the extensions array keeps
    // a stable identity — @uiw/react-codemirror reconfigures when it changes,
    // which would clobber the sql compartment's hot-swapped schema.
    const handlersRef = useRef({
      onExecuteSelection,
      onExecuteAll,
      onExecuteStatement,
      handleFormat,
    });
    handlersRef.current = {
      onExecuteSelection,
      onExecuteAll,
      onExecuteStatement,
      handleFormat,
    };

    const extensions = useMemo(() => {
      const base: Extension[] = [
        sqlCompartment.of(
          currentSetupRef.current ??
            makeSqlSetup(null, autoCompleteRef.current, defaultDbRef.current),
        ),
      ];
      base.push(
        Prec.highest(
          keymap.of([
            {
              // Mod-Enter: selection if present, else the statement under the
              // cursor, else the whole editor (documented in docs/features.md).
              key: "Mod-Enter",
              run: (view) => {
                const h = handlersRef.current;
                const { from, to } = view.state.selection.main;
                if (from !== to && h.onExecuteSelection) {
                  h.onExecuteSelection(view.state.sliceDoc(from, to));
                  return true;
                }
                if (h.onExecuteStatement) {
                  const stmt = statementRangeAt(
                    view.state.doc.toString(),
                    view.state.selection.main.head,
                  );
                  if (stmt) {
                    h.onExecuteStatement(stmt.text);
                    return true;
                  }
                }
                h.onExecuteAll?.();
                return true;
              },
            },
            {
              key: "Mod-Shift-Enter",
              run: (view) => {
                const h = handlersRef.current;
                const { from, to } = view.state.selection.main;
                if (from !== to && h.onExecuteSelection) {
                  h.onExecuteSelection(view.state.sliceDoc(from, to));
                  return true;
                }
                // No selection: run everything.
                h.onExecuteAll?.();
                return true;
              },
            },
            {
              key: "Mod-Shift-f",
              preventDefault: true,
              run: () => {
                handlersRef.current.handleFormat();
                return true;
              },
            },
          ]),
        ),
      );
      return base;
    }, [sqlCompartment]);

    const hasSelection = contextMenu?.hasSelection ?? false;

    // Stable identity: @uiw reconfigures the whole EditorState (resetting
    // compartments) whenever basicSetup/onUpdate change identity, so these
    // must not be inline objects/functions. The built-in autocompletion
    // instance stays when the setting is on — completion activation
    // (typing + Ctrl-Space) depends on it; the sql compartment layers the
    // keyword/schema override source on top.
    const basicSetupOptions = useMemo(
      () => ({
        tabSize: editorSettings.tabSize,
        lineNumbers: true,
        highlightActiveLineGutter: true,
        highlightActiveLine: true,
        foldGutter: false,
        autocompletion: autoComplete,
      }),
      [editorSettings.tabSize, autoComplete],
    );

    return (
      <div className="h-full w-full relative" onContextMenu={handleContextMenu}>
        <CodeMirror
          ref={cmRef}
          value={sql}
          height="100%"
          theme={editorTheme}
          extensions={extensions}
          placeholder={placeholder}
          onChange={onChange}
          onUpdate={handleUpdate}
          basicSetup={basicSetupOptions}
          style={{ fontSize: `${editorSettings.fontSize}px` }}
        />
        {contextMenu && (
          <div
            className="fixed z-[60] min-w-[170px] py-1 bg-card border border-border rounded-lg shadow-xl animate-menu-in"
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
