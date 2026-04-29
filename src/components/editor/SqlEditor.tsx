import React, { useEffect, useRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { sql } from '@codemirror/lang-sql';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { useUIStore } from '../../stores/uiStore';
import { useSchemaCacheStore } from '../../stores/schemaCacheStore';
import { useConnectionStore } from '../../stores/connectionStore';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  readOnly?: boolean;
}

const SqlEditor: React.FC<Props> = ({ value, onChange, onRun, readOnly }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const theme = useUIStore((s) => s.theme);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const schemaCache = useSchemaCacheStore();

  const buildCompletions = useCallback(
    (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w.`]+/);
      if (!word || (word.from === word.to && !context.explicit)) return null;

      const text = word.text;
      const parts = text.split('.');

      let options: { label: string; type: string; detail?: string; apply?: string }[] = [];

      if (!activeConnectionId) {
        // Default SQL keywords
        options = [
          { label: 'SELECT', type: 'keyword' },
          { label: 'FROM', type: 'keyword' },
          { label: 'WHERE', type: 'keyword' },
          { label: 'INSERT', type: 'keyword' },
          { label: 'UPDATE', type: 'keyword' },
          { label: 'DELETE', type: 'keyword' },
          { label: 'CREATE', type: 'keyword' },
          { label: 'ALTER', type: 'keyword' },
          { label: 'DROP', type: 'keyword' },
          { label: 'JOIN', type: 'keyword' },
          { label: 'LEFT JOIN', type: 'keyword' },
          { label: 'INNER JOIN', type: 'keyword' },
          { label: 'ON', type: 'keyword' },
          { label: 'AND', type: 'keyword' },
          { label: 'OR', type: 'keyword' },
          { label: 'ORDER BY', type: 'keyword' },
          { label: 'GROUP BY', type: 'keyword' },
          { label: 'HAVING', type: 'keyword' },
          { label: 'LIMIT', type: 'keyword' },
          { label: 'OFFSET', type: 'keyword' },
          { label: 'AS', type: 'keyword' },
          { label: 'NOT NULL', type: 'keyword' },
          { label: 'IN', type: 'keyword' },
          { label: 'LIKE', type: 'keyword' },
          { label: 'BETWEEN', type: 'keyword' },
          { label: 'IS NULL', type: 'keyword' },
          { label: 'COUNT', type: 'function' },
          { label: 'SUM', type: 'function' },
          { label: 'AVG', type: 'function' },
          { label: 'MAX', type: 'function' },
          { label: 'MIN', type: 'function' },
        ];
      } else {
        // Schema-aware completions
        const databases = schemaCache.getDatabases(activeConnectionId);
        const allTables: { db: string; name: string }[] = [];

        for (const db of databases) {
          const tables = schemaCache.getTables(activeConnectionId, db);
          for (const t of tables) {
            allTables.push({ db, name: t.name });
          }
        }

        if (parts.length === 1) {
          // Suggest databases and tables
          options.push(
            ...databases.map((d) => ({ label: d, type: 'namespace' })),
            ...allTables.map((t) => ({ label: t.name, type: 'table', detail: t.db }))
          );

          // Add keywords
          options.push(
            { label: 'SELECT', type: 'keyword' },
            { label: 'FROM', type: 'keyword' },
            { label: 'WHERE', type: 'keyword' },
            { label: 'JOIN', type: 'keyword' },
            { label: 'LEFT JOIN', type: 'keyword' },
            { label: 'ORDER BY', type: 'keyword' },
            { label: 'GROUP BY', type: 'keyword' },
            { label: 'LIMIT', type: 'keyword' },
          );
        } else if (parts.length === 2) {
          // database.table - suggest tables in that database
          const dbName = parts[0];
          const tables = schemaCache.getTables(activeConnectionId, dbName);
          options = tables.map((t) => ({ label: t.name, type: 'table', detail: dbName }));
        } else if (parts.length === 3) {
          // database.table.column - suggest columns
          const dbName = parts[0];
          const tableName = parts[1];
          const columns = schemaCache.getColumns(activeConnectionId, dbName, tableName);
          options = columns.map((c) => ({
            label: c.name,
            type: c.is_primary_key ? 'keyword' : 'property',
            detail: c.type_name,
          }));
        }
      }

      return {
        from: word.from,
        options,
        filter: true,
      };
    },
    [activeConnectionId, schemaCache]
  );

  useEffect(() => {
    if (!editorRef.current) return;

    const runKeymap = keymap.of([
      {
        key: 'Ctrl-Enter',
        run: () => {
          onRun();
          return true;
        },
      },
      {
        key: 'Cmd-Enter',
        run: () => {
          onRun();
          return true;
        },
      },
    ]);

    const extensions = [
      lineNumbers(),
      history(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      highlightSelectionMatches(),
      sql(),
      autocompletion({
        override: [buildCompletions],
        activateOnTyping: true,
      }),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
      ]),
      runKeymap,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace' },
        '.cm-content': { padding: '4px 0' },
        '.cm-gutters': { borderRight: '1px solid var(--border-primary)' },
      }),
    ];

    if (theme === 'dark') {
      extensions.push(oneDark);
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [theme]); // Only re-create on theme change

  // Sync external value changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={editorRef} className="h-full w-full" />;
};

export default SqlEditor;
