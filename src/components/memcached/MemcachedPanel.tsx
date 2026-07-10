import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  Search,
  RefreshCw,
  Trash2,
  Eye,
  AlertTriangle,
  Cpu,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useMemcachedStore } from "../../stores/memcachedStore";
import { VirtualList } from "../virtual/VirtualList";
export function MemcachedPanel() {
  const { t } = useTranslation("memcached");
  const activeId = useConnectionStore((s) => s.activeId);
  const setSidebarView = useLayoutStore((s) => s.setSidebarView);
  const setActiveId = useConnectionStore((s) => s.setActiveId);

  const {
    keys,
    totalKeys,
    truncated,
    serverInfo,
    searchQuery,
    isLoadingKeys,
    isFlushing,
    error,
    loadKeys,
    loadServerInfo,
    deleteItem,
    flushAll,
    setSearchQuery,
    setSelectedKey,
  } = useMemcachedStore();

  useEffect(() => {
    if (activeId) {
      loadKeys(activeId);
      loadServerInfo(activeId);
    }
  }, [activeId, loadKeys, loadServerInfo]);

  const handleSearch = useCallback(() => {
    if (!activeId) return;
    loadKeys(activeId, searchQuery || undefined);
  }, [activeId, searchQuery, loadKeys]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch],
  );

  const handleViewItem = (key: string) => {
    setSelectedKey(key);
  };

  const handleDeleteItem = async (key: string) => {
    if (!activeId) return;
    if (!confirm(t("confirmDelete", { key }))) return;
    await deleteItem(activeId, key);
  };

  const handleFlushAll = async () => {
    if (!activeId) return;
    if (!confirm(t("confirmFlushAll"))) return;
    await flushAll(activeId);
  };

  const handleBack = () => {
    setActiveId(null);
    setSidebarView("connection");
  };

  const handleRefresh = () => {
    if (!activeId) return;
    loadKeys(activeId, searchQuery || undefined);
    loadServerInfo(activeId);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-border">
        <button
          className="p-1 rounded hover:bg-accent"
          onClick={handleBack}
          title={t("backToConnections")}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Cpu size={14} className="shrink-0 text-muted-foreground" />
          {t("title")}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-accent"
            onClick={handleRefresh}
            disabled={isLoadingKeys}
            title={t("refresh")}
          >
            <RefreshCw size={14} className={isLoadingKeys ? "animate-spin" : ""} />
          </button>
          <button
            className="p-1 rounded hover:bg-accent text-destructive"
            onClick={handleFlushAll}
            disabled={isFlushing}
            title={t("flushAll")}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {serverInfo && (
        <div className="px-2 py-1.5 border-b border-border bg-muted/30 text-xs text-muted-foreground grid grid-cols-2 gap-x-2 gap-y-0.5">
          <span>{t("items")}: {serverInfo.currItems}</span>
          <span>{t("uptime")}: {formatUptime(serverInfo.uptimeSeconds)}</span>
          <span>
            {t("memory")}: {formatBytes(serverInfo.bytesUsed)} / {formatBytes(serverInfo.limitMaxbytes)}
          </span>
          <span>{t("connections")}: {serverInfo.currConnections}</span>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-1 p-2 border-b border-border">
        <div className="flex-1 flex items-center gap-1.5 bg-muted rounded-md px-2 py-1">
          <Search size={14} className="text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <button
          className="p-1 rounded hover:bg-accent text-xs"
          onClick={handleSearch}
          disabled={isLoadingKeys}
        >
          {t("search")}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-1.5 px-2 py-2 text-xs text-destructive bg-destructive/5 border-b border-destructive/10">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Key list */}
      <div className="flex-1 overflow-hidden">
        {isLoadingKeys ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {t("loadingKeys")}
          </div>
        ) : keys.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {searchQuery ? t("noMatchingKeys") : t("noKeys")}
          </div>
        ) : (
          <>
            {truncated && (
              <div className="px-2 py-1 text-xs text-yellow-600 bg-yellow-500/5 border-b border-yellow-500/10">
                {t("truncated", { count: totalKeys })}
              </div>
            )}
            <VirtualList
              items={keys}
              rowHeight={32}
              renderItem={(key) => (
                <div className="flex items-center justify-between px-3 py-1 hover:bg-accent/50 cursor-pointer group text-sm">
                  <span
                    className="truncate flex-1 min-w-0"
                    onClick={() => handleViewItem(key)}
                    title={key}
                  >
                    {key}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-0.5 rounded hover:bg-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewItem(key);
                      }}
                      title={t("viewItem")}
                    >
                      <Eye size={12} />
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-accent text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(key);
                      }}
                      title={t("deleteItem")}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            />
          </>
        )}
      </div>

    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
  const m = Math.floor(seconds / 60);
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)}G`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${bytes}B`;
}
