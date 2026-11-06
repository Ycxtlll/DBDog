import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, X } from "lucide-react";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";
import { showSuccess } from "../../stores/toastStore";

interface LargeValueDrawerProps {
  open: boolean;
  columnName?: string;
  tableName?: string;
  value?: unknown;
  onClose: () => void;
}

/** Format kind detected from the raw text. */
type FormatKind = "json" | "xml" | null;

function detectJson(trimmed: string): unknown | null {
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    const v: unknown = JSON.parse(trimmed);
    return typeof v === "object" && v !== null ? v : null;
  } catch {
    return null;
  }
}

function looksLikeXml(trimmed: string): boolean {
  return /^<\s*(\?xml|!DOCTYPE|!--|[\w:-]+)/.test(trimmed) && trimmed.endsWith(">");
}

/**
 * Minimal XML pretty-printer for display: compacts whitespace between
 * lines, splits adjacent tags onto separate lines and indents by nesting
 * depth. Declarations/comments/self-closing tags never change depth. Text
 * nodes stay inline with their element (`<a>text</a>` remains one line).
 * Imperfect by design — the raw view is always one click away.
 */
function formatXml(xml: string): string {
  const compact = xml
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("");
  const tokens = compact.replace(/></g, ">\n<").split("\n");
  let depth = 0;
  const out: string[] = [];
  for (const token of tokens) {
    if (/^<\//.test(token)) {
      depth = Math.max(0, depth - 1);
      out.push("  ".repeat(depth) + token);
      continue;
    }
    out.push("  ".repeat(depth) + token);
    const selfClosing = /\/>$/.test(token);
    const declaration = /^<(\?|!)/.test(token);
    // `<a>text</a>` stays one token and must not open a level.
    const closesInline = /<\/[\w:-]+>$/.test(token);
    if (!selfClosing && !declaration && !closesInline && /^<[\w:-]/.test(token)) {
      depth++;
    }
  }
  return out.join("\n");
}

/**
 * Full-content viewer for LONGTEXT/JSON/XML cells: auto-detects the format,
 * renders pretty JSON / indented XML, keeps a raw toggle — and copying
 * ALWAYS yields the original value regardless of the current view.
 */
export function LargeValueDrawer({ open, columnName, tableName, value, onClose }: LargeValueDrawerProps) {
  const { t } = useTranslation("query");
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active: open, onEscape: onClose });
  const show = useDelayedUnmount(open);
  const closing = show && !open;

  // Raw text is the single source of truth — display modes are projections,
  // and copy always takes from it. JSON columns decode to JS objects; the
  // grid and row modal render them as JSON text and so does the drawer.
  const raw =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Detection is O(n) with full-string copies (parse/indent) — capped so a
  // multi-MB TEXT value opens instantly as raw instead of freezing the
  // drawer; the toggle still lets the user opt in.
  const DETECT_CAP = 1_000_000;
  const detectable = raw.length <= DETECT_CAP;
  const parsedJson = useMemo(
    () => (detectable ? detectJson(raw.trim()) : null),
    [raw, detectable],
  );
  const isXml = useMemo(
    () => detectable && parsedJson === null && looksLikeXml(raw.trim()),
    [raw, detectable, parsedJson],
  );
  const formatKind: FormatKind = parsedJson !== null ? "json" : isXml ? "xml" : null;
  const formattedText = useMemo(() => {
    if (formatKind === "json" && parsedJson !== null) return JSON.stringify(parsedJson, null, 2);
    if (formatKind === "xml") return formatXml(raw);
    return raw;
  }, [formatKind, parsedJson, raw]);

  const [formatted, setFormatted] = useState(true);
  const [copied, setCopied] = useState(false);

  // Reset the view mode per opened value (formatted defaults on when the
  // content is detectable).
  useEffect(() => {
    if (open) {
      setFormatted(formatKind !== null);
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per value
  }, [open, raw]);

  const displayText = formatted ? formattedText : raw;

  // Copy is ALWAYS the raw/original value — the formatted view is display-only.
  const handleCopy = () => {
    navigator.clipboard
      .writeText(raw)
      .then(() => {
        setCopied(true);
        showSuccess(t("copiedToast"));
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  if (!show) return null;

  return (
    <div
      ref={panelRef}
      className={`fixed right-0 top-0 bottom-0 w-[560px] max-w-[90vw] bg-card border-l border-border shadow-2xl z-[70] flex flex-col ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{columnName}</span>
          {tableName && (
            <span className="text-xs font-mono text-primary bg-primary/10 rounded-md px-1.5 py-0.5">
              {tableName}
            </span>
          )}
          {formatKind && (
            <span className="text-xs text-muted-foreground uppercase">{formatKind}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {formatKind && (
            <div className="flex items-center rounded-md border border-border overflow-hidden mr-1">
              <button
                onClick={() => setFormatted(false)}
                className={`px-2 py-1 text-xs transition-colors ${!formatted ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {t("rawText")}
              </button>
              <button
                onClick={() => setFormatted(true)}
                className={`px-2 py-1 text-xs transition-colors ${formatted ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {t("formatted")}
              </button>
            </div>
          )}
          <button
            onClick={handleCopy}
            className={`p-1.5 rounded-md transition-colors ${copied ? "text-green-600" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            title={t("copyRawValue")}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label={t("close")}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground leading-relaxed">{displayText}</pre>
      </div>
    </div>
  );
}
