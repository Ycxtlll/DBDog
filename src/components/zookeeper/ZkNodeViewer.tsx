import { useTranslation } from "react-i18next";
import type { ZkNode } from "../../types";

interface ZkNodeViewerProps {
  node: ZkNode;
}

export function ZkNodeViewer({ node }: ZkNodeViewerProps) {
  const { t } = useTranslation("zookeeper");

  const isLargeValue = node.data.length > 2048;
  const displayData = isLargeValue
    ? node.data.slice(0, 2048) +
      "\n\n... (" +
      t("valueTruncated", { size: formatBytes(node.data.length) }) +
      ")"
    : node.data;

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 space-y-4">
        {/* Header */}
        <h3 className="text-sm font-semibold font-mono truncate" title={node.path}>
          {node.path}
        </h3>

        {/* Stat grid */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            {t("nodeStats")}
          </label>
          <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono">
            <StatCell label="czxid" value={node.czxid} />
            <StatCell label="mzxid" value={node.mzxid} />
            <StatCell label="pzxid" value={node.pzxid} />
            <StatCell label="ctime" value={formatZkTime(node.ctime)} />
            <StatCell label="mtime" value={formatZkTime(node.mtime)} />
            <StatCell label="version" value={node.version} />
            <StatCell label="childVersion" value={node.childVersion} />
            <StatCell label="aclVersion" value={node.aclVersion} />
            <StatCell label="dataLength" value={formatBytes(node.dataLength)} />
            <StatCell label="numChildren" value={node.numChildren} />
            <StatCell
              label="ephemeralOwner"
              value={
                node.ephemeralOwner !== 0
                  ? `0x${node.ephemeralOwner.toString(16)}`
                  : "—"
              }
            />
          </div>
        </div>

        {/* Data */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
            {t("nodeData")}
          </label>
          <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-[50vh] whitespace-pre-wrap break-all font-mono leading-relaxed">
            {displayData || (
              <span className="text-muted-foreground italic">
                {t("emptyValue")}
              </span>
            )}
          </pre>
          {isLargeValue && (
            <p className="text-[10px] text-yellow-600 mt-1">
              {t("valueTruncated", { size: formatBytes(node.data.length) })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-muted rounded px-2 py-1 flex items-baseline gap-1.5">
      <span className="text-[10px] text-muted-foreground shrink-0">{label}</span>
      <span className="truncate tabular-nums">{value}</span>
    </div>
  );
}

function formatZkTime(ms: number): string {
  if (ms <= 0) return "—";
  return new Date(ms).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
