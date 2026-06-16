import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { useMemcachedStore } from "../../stores/memcachedStore";

interface MemcachedItemModalProps {
  connectionId: string;
  keyName: string;
  onClose: () => void;
}

export function MemcachedItemModal({
  connectionId,
  keyName,
  onClose,
}: MemcachedItemModalProps) {
  const { t } = useTranslation("memcached");
  const { loadItem, selectedItem, isLoadingItem, error } = useMemcachedStore();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    loadItem(connectionId, keyName);
  }, [connectionId, keyName, loadItem]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const valueDisplay = selectedItem?.value ?? "";
  const isLarge = valueDisplay.length > 2048;
  const truncatedValue = isLarge
    ? valueDisplay.slice(0, 2048) + "\n\n... (" + t("valueTruncated", { size: formatBytes(valueDisplay.length) }) + ")"
    : valueDisplay;

  const expText = selectedItem?.expiration != null
    ? selectedItem.expiration <= 0
      ? t("never")
      : new Date(selectedItem.expiration * 1000).toLocaleString()
    : "N/A";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[90vw] max-h-[85vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
          <h3 className="text-sm font-semibold truncate max-w-[80%]" title={keyName}>
            {t("key")}: {keyName}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {isLoadingItem ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              {t("loading")}
            </div>
          ) : error && !dismissed ? (
            <div className="flex items-start gap-2 p-4 text-sm text-destructive">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="break-all">{error}</p>
                <button
                  className="mt-2 text-xs underline"
                  onClick={() => setDismissed(true)}
                >
                  {t("dismiss")}
                </button>
              </div>
            </div>
          ) : selectedItem ? (
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <MetaBadge label={t("flags")} value={String(selectedItem.flags)} />
                <MetaBadge label={t("size")} value={formatBytes(selectedItem.sizeBytes)} />
                <MetaBadge label={t("expiration")} value={expText} />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  {t("value")}
                  {isLarge && (
                    <span className="ml-2 text-yellow-500">
                      ({t("valueTruncated", { size: formatBytes(valueDisplay.length) })})
                    </span>
                  )}
                </label>
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-[50vh] whitespace-pre-wrap break-all font-mono leading-relaxed">
                  {truncatedValue || (
                    <span className="text-muted-foreground italic">{t("empty")}</span>
                  )}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t("notFound")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded-md px-2 py-1.5 flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className="font-mono text-xs truncate">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
