import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlExtension, MySQL } from "@codemirror/lang-sql";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { keymap } from "@codemirror/view";
import { useMemo } from "react";
import { useUiStore } from "../../stores/uiStore";

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

interface SqlEditorProps {
  tabId: string;
  sql: string;
  onChange: (sql: string) => void;
  onExecute?: () => void;
  onExecuteSelection?: (selectedSql: string) => void;
}

export function SqlEditor({
  sql,
  onChange,
  onExecute,
  onExecuteSelection,
}: SqlEditorProps) {
  const { theme, editor } = useUiStore();
  const editorTheme = useMemo(() => {
    if (theme === "dark") return vscodeDark;
    if (theme === "light") return vscodeLight;
    return getSystemTheme() === "dark" ? vscodeDark : vscodeLight;
  }, [theme]);

  const extensions = useMemo(() => {
    const base: import("@codemirror/state").Extension[] = [
      sqlExtension({ dialect: MySQL }),
    ];
    if (onExecute || onExecuteSelection) {
      base.push(
        keymap.of([
          {
            key: "Ctrl-Enter",
            run: () => {
              onExecute?.();
              return true;
            },
          },
          {
            key: "Ctrl-Shift-Enter",
            run: (view) => {
              const { from, to } = view.state.selection.main;
              const selected = view.state.sliceDoc(from, to);
              onExecuteSelection?.(selected);
              return true;
            },
          },
        ]),
      );
    }
    return base;
  }, [onExecute, onExecuteSelection]);

  return (
    <div className="h-full w-full">
      <CodeMirror
        value={sql}
        height="100%"
        theme={editorTheme}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          tabSize: editor.tabSize,
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: false,
        }}
        style={{ fontSize: `${editor.fontSize}px` }}
      />
    </div>
  );
}
