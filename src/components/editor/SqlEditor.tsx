import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlExtension, MySQL } from "@codemirror/lang-sql";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { useUiStore } from "../../stores/uiStore";

interface SqlEditorProps {
  tabId: string;
  sql: string;
  onChange: (sql: string) => void;
}

export function SqlEditor({ sql, onChange }: SqlEditorProps) {
  const { theme, editor } = useUiStore();
  const editorTheme =
    theme === "dark" ? vscodeDark : theme === "light" ? vscodeLight : undefined;

  return (
    <div className="h-full w-full">
      <CodeMirror
        value={sql}
        height="100%"
        theme={editorTheme}
        extensions={[sqlExtension({ dialect: MySQL })]}
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
