import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, AlertTriangle } from "lucide-react";
import { useMemcachedStore } from "../../stores/memcachedStore";

interface MemoEntryViewerProps {
  connectionId: string;
  keyName: string;
}

export function MemoEntryViewer({ connectionId, keyName }: MemoEntryViewerProps) {
  const { t } = useTranslation("memcached");
  const { loadItem, selectedItem, isLoadingItem, error } = useMemcachedStore();

  useEffect(() => {
    loadItem(connectionId, keyName);
  }, [connectionId, keyName, loadItem]);

  if (isLoadingItem) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-sm">{t("loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4">
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="break-all">{error}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("errorHint", "请检查 Key 是否存在或刷新 Key 列表")}
        </p>
      </div>
    );
  }

  if (!selectedItem) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {t("noKeys")}
      </div>
    );
  }

  const valueDisplay = selectedItem.value ?? "";
  const isLarge = valueDisplay.length > 2048;
  const truncatedValue = isLarge
    ? valueDisplay.slice(0, 2048) +
      "\n\n... (" +
      t("valueTruncated", { size: formatBytes(valueDisplay.length) }) +
      ")"
    : valueDisplay;

  const expText =
    selectedItem.expiration != null
      ? selectedItem.expiration <= 0
        ? t("never")
        : new Date(selectedItem.expiration * 1000).toLocaleString()
      : "N/A";

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 space-y-4">
        <h3 className="text-sm font-semibold font-mono truncate" title={keyName}>
          {keyName}
        </h3>

        {/* Meta */}
        <div className="flex items-center gap-4 text-xs">
          <MetaBadge label={t("flags")} value={String(selectedItem.flags ?? 0)} />
          <MetaBadge label={t("expiration")} value={expText} />
          <MetaBadge
            label={t("size")}
            value={formatBytes(selectedItem.sizeBytes ?? valueDisplay.length)}
          />
        </div>

        {/* Value */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
            {t("value")}
          </label>
          <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-[50vh] whitespace-pre-wrap break-all font-mono leading-relaxed">
            {truncatedValue || (
              <span className="text-muted-foreground italic">{t("empty")}</span>
            )}
          </pre>
          {isLarge && (
            <p className="text-[10px] text-yellow-600 mt-1">
              {t("valueTruncated", { size: formatBytes(valueDisplay.length) })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-muted rounded px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
