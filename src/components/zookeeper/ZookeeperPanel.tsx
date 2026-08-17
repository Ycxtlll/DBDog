import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  RefreshCw,
  AlertTriangle,
  Network,
  ChevronRight,
  Home,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useZookeeperStore } from "../../stores/zookeeperStore";
import { VirtualTree } from "../virtual/VirtualTree";
import type { ZkTreeNode } from "../../types";

/** Find a node by absolute path (mirrors the helper in zookeeperStore). */
function findZkNode(node: ZkTreeNode, path: string): ZkTreeNode | null {
  if (node.path === path) return node;
  for (const child of node.children ?? []) {
    const found = findZkNode(child, path);
    if (found) return found;
  }
  return null;
}

export function ZookeeperPanel() {
  const { t } = useTranslation("zookeeper");
  const activeId = useConnectionStore((s) => s.activeId);
  const setSidebarView = useLayoutStore((s) => s.setSidebarView);
  const setActiveId = useConnectionStore((s) => s.setActiveId);

  const {
    rootNode,
    serverInfo,
    currentPath,
    isLoadingTree,
    error,
    loadTree,
    expandNode,
    loadNode,
    loadServerInfo,
    setCurrentPath,
    clearError,
    refresh,
  } = useZookeeperStore();

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set(["/"]));

  useEffect(() => {
    if (activeId) {
      loadTree(activeId, "/", 3);
      loadServerInfo(activeId);
    }
  }, [activeId, loadTree, loadServerInfo]);

  const handleToggle = useCallback(
    (key: string) => {
      const willExpand = !expandedKeys.has(key);
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
      // Frontier nodes (children === undefined but hasChildren) have no data
      // to render — fetch one level and merge it in on first expansion.
      if (willExpand && activeId && rootNode) {
        const target = findZkNode(rootNode, key);
        if (target && target.children === undefined) {
          expandNode(activeId, key);
        }
      }
    },
    [expandedKeys, activeId, rootNode, expandNode],
  );

  const handleSelectNode = (path: string) => {
    if (!activeId) return;
    setCurrentPath(path);
    loadNode(activeId, path);
  };

  const handleRefresh = () => {
    if (!activeId) return;
    refresh(activeId);
  };

  const handleBack = () => {
    setActiveId(null);
    setSidebarView("connection");
  };

  const handleNavigateTo = (path: string) => {
    if (!activeId) return;
    setCurrentPath(path);
    loadTree(activeId, path, 3);
  };

  const treeRoots = rootNode ? [toVirtualTreeNode(rootNode)] : [];
  const breadcrumbs = currentPath.split("/").filter(Boolean);

  const statusColor =
    serverInfo?.mode === "leader" ? "bg-amber-500" : "bg-emerald-500";

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
          <Network size={14} className="shrink-0 text-muted-foreground" />
          {t("title")}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-accent"
            onClick={handleRefresh}
            disabled={isLoadingTree}
            title={t("refresh")}
          >
            <RefreshCw
              size={14}
              className={isLoadingTree ? "animate-spin" : ""}
            />
          </button>
        </div>
      </div>

      {/* Stats bar — only show when mntr returned real data */}
      {serverInfo && serverInfo.mode !== "unknown" && (
        <div className="px-2 py-1.5 border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap font-mono">
            <span className="inline-flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
              {serverInfo.mode}
            </span>
            {serverInfo.version && serverInfo.version !== "unknown" && (
              <span>v{truncateVersion(serverInfo.version)}</span>
            )}
            <span>
              {t("znodes")}: {serverInfo.znodeCount.toLocaleString()}
            </span>
            <span>
              {t("connections")}: {serverInfo.connections}
            </span>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border text-xs overflow-x-auto whitespace-nowrap">
        <button
          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => handleNavigateTo("/")}
          title="/"
        >
          <Home size={12} />
        </button>
        {breadcrumbs.map((seg, i) => {
          const fullPath = "/" + breadcrumbs.slice(0, i + 1).join("/");
          return (
            <span key={fullPath} className="flex items-center gap-0.5">
              <ChevronRight size={10} className="text-muted-foreground shrink-0" />
              <button
                className="px-1 py-0.5 rounded hover:bg-accent hover:text-foreground text-muted-foreground truncate max-w-[120px] font-mono"
                onClick={() => handleNavigateTo(fullPath)}
                title={fullPath}
              >
                {seg}
              </button>
            </span>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-destructive bg-destructive/5 border-b border-destructive/10">
          <AlertTriangle size={12} />
          <span className="truncate flex-1">{error}</span>
          <button
            className="p-0.5 rounded hover:bg-destructive/10 shrink-0"
            onClick={clearError}
          >
            ×
          </button>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-hidden">
        {isLoadingTree ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {t("loadingNodes")}
          </div>
        ) : !rootNode ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {t("noNodes")}
          </div>
        ) : (
          <VirtualTree
            roots={treeRoots}
            expandedKeys={expandedKeys}
            onToggle={handleToggle}
            rowHeight={30}
            renderNode={(n: ZkNodeData, _depth, _exp) => (
              <div className="flex items-center flex-1 min-w-0 pr-2">
                <span
                  className="truncate text-sm font-mono cursor-pointer hover:text-primary transition-colors"
                  title={n.path}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectNode(n.path);
                  }}
                >
                  <span className={n.isEphemeral ? "text-amber-500" : "text-foreground"}>
                    {n.name}
                  </span>
                  {n.numChildren > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({n.numChildren})
                    </span>
                  )}
                </span>
              </div>
            )}
            hasChildren={(n: ZkNodeData) => n.hasChildren}
          />
        )}
      </div>
    </div>
  );
}

// ── Adapter ──

interface ZkNodeData {
  name: string;
  path: string;
  numChildren: number;
  isEphemeral: boolean;
  hasChildren: boolean;
}

interface ZkVirtualNode {
  id: string;
  data: ZkNodeData;
  children?: ZkVirtualNode[];
}

function toVirtualTreeNode(zk: ZkTreeNode): ZkVirtualNode {
  return {
    id: zk.path,
    data: {
      name: zk.name,
      path: zk.path,
      numChildren: zk.numChildren,
      isEphemeral: zk.isEphemeral,
      hasChildren:
        zk.children === undefined
          ? zk.numChildren > 0
          : (zk.children?.length ?? 0) > 0,
    },
    children: zk.children?.map(toVirtualTreeNode),
  };
}

function truncateVersion(v: string): string {
  return v.split("-")[0] || v;
}
