import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Plug,
  Unplug,
  Trash2,
  Edit2,
  Database,
  Cpu,
  Network,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { translateTauriError } from "../../lib/error";
import { showError } from "../../stores/toastStore";
import { confirmDialog } from "../../lib/confirm";
import type { ConnectionConfig } from "../../types";
import { ConnectionFormModal } from "../connection/ConnectionFormModal";

const TYPE_ICON: Record<string, typeof Database> = {
  mysql: Database,
  memcached: Cpu,
  zookeeper: Network,
};

const TYPE_AUTO_GROUP: Record<string, string> = {
  mysql: "MySQL",
  memcached: "Memcached",
  zookeeper: "ZooKeeper",
};

interface ConnectionGroup {
  key: string;
  label: string;
  configs: ConnectionConfig[];
}

export function ConnectionPanel() {
  const { t } = useTranslation("connections");
  const configs = useConnectionStore((s) => s.configs);
  const statusMap = useConnectionStore((s) => s.statusMap);
  const activeId = useConnectionStore((s) => s.activeId);
  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const deleteConfig = useConnectionStore((s) => s.deleteConfig);
  const setActiveId = useConnectionStore((s) => s.setActiveId);
  const { setSidebarView } = useLayoutStore();
  const [editing, setEditing] = useState<ConnectionConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const groups = useMemo((): ConnectionGroup[] => {
    const map = new Map<string, ConnectionConfig[]>();
    for (const config of configs) {
      const key = config.group || TYPE_AUTO_GROUP[config.type] || config.type;
      const list = map.get(key) || [];
      list.push(config);
      map.set(key, list);
    }
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([key, configs]) => {
      const isAuto = !configs.some((c) => c.group);
      const label = isAuto && TYPE_AUTO_GROUP[key]
        ? `${TYPE_AUTO_GROUP[key]} (${t("autoGroup")})`
        : key;
      return { key, label, configs };
    });
  }, [configs, t]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleConnect = async (cfg: ConnectionConfig) => {
    const targetView =
      cfg.type === "memcached" ? "memcached"
      : cfg.type === "zookeeper" ? "zookeeper"
      : "schema";
    if (statusMap[cfg.id] === "connected") {
      setActiveId(cfg.id);
      setSidebarView(targetView);
    } else {
      try {
        await connect(cfg.id);
        setActiveId(cfg.id);
        setSidebarView(targetView);
      } catch (err) {
        const msg = translateTauriError(err, t);
        showError(msg);
        console.error("Failed to connect:", err);
      }
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnect(id);
    } catch (err) {
      showError(translateTauriError(err, t));
      console.error("Failed to disconnect:", err);
    }
    setSidebarView("connection");
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog(t("confirmDelete")))) return;
    try {
      await deleteConfig(id);
    } catch (err) {
      showError(translateTauriError(err, t));
      console.error("Failed to delete connection:", err);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-2 border-b border-border">
        <span className="text-sm font-medium">{t("connections")}</span>
        <button
          className="p-1 rounded hover:bg-accent"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {configs.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">
            {t("noConnections", "No connections yet")}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="border-b border-border/30">
              <button
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                onClick={() => toggleGroup(group.key)}
              >
                {collapsedGroups.has(group.key) ? (
                  <ChevronRight size={12} className="shrink-0" />
                ) : (
                  <ChevronDown size={12} className="shrink-0" />
                )}
                <span className="flex-1 text-left truncate">{group.label}</span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {group.configs.length}
                </span>
              </button>
              {!collapsedGroups.has(group.key) &&
                group.configs.map((config) => (
                  <ConnectionRow
                    key={config.id}
                    config={config}
                    isActive={activeId === config.id}
                    status={statusMap[config.id] || "disconnected"}
                    onConnect={() => handleConnect(config)}
                    onDisconnect={() => handleDisconnect(config.id)}
                    onEdit={() => {
                      setEditing(config);
                      setShowForm(true);
                    }}
                    onDelete={() => handleDelete(config.id)}
                  />
                ))}
            </div>
          ))
        )}
      </div>
      {showForm && (
        <ConnectionFormModal config={editing} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}

function ConnectionRow({
  config,
  isActive,
  status,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: {
  config: ConnectionConfig;
  isActive: boolean;
  status: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = TYPE_ICON[config.type] || Database;

  return (
    <div
      className={`flex items-center justify-between pl-5 pr-2 py-1.5 cursor-pointer ${
        isActive ? "bg-accent" : "hover:bg-accent/50"
      }`}
      onClick={onConnect}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={14} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm truncate">{config.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {config.host}:{config.port}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span
          className={`w-2 h-2 rounded-full ${
            status === "connected"
              ? "bg-green-500"
              : status === "connecting"
                ? "bg-yellow-500"
                : status === "error"
                  ? "bg-red-500"
                  : "bg-gray-400"
          }`}
        />
        {status === "connected" ? (
          <button
            className="p-1 rounded hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              onDisconnect();
            }}
          >
            <Unplug size={14} />
          </button>
        ) : (
          <button
            className="p-1 rounded hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              onConnect();
            }}
          >
            <Plug size={14} />
          </button>
        )}
        <button
          className="p-1 rounded hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Edit2 size={14} />
        </button>
        <button
          className="p-1 rounded hover:bg-accent text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
