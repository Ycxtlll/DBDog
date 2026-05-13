import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Plug, Unplug, Trash2, Edit2, Database } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useLayoutStore } from "../../stores/layoutStore";
import * as connectionService from "../../services/connectionService";
import type { ConnectionConfig } from "../../types";
import { VirtualList } from "../virtual/VirtualList";

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

  const handleConnect = async (id: string) => {
    if (statusMap[id] === "connected") {
      setActiveId(id);
      setSidebarView("schema");
    } else {
      const cfg = configs.find((c) => c.id === id);
      await connect(id, cfg?.password);
      setActiveId(id);
      setSidebarView("schema");
    }
  };

  const handleDisconnect = async (id: string) => {
    await disconnect(id);
  };

  const handleDelete = async (id: string) => {
    if (confirm(t("confirmDelete"))) {
      await deleteConfig(id);
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
      <div className="flex-1 overflow-hidden">
        <VirtualList
          items={configs}
          rowHeight={48}
          renderItem={(config) => (
            <div
              className={`flex items-center justify-between px-3 py-2 border-b border-border/50 cursor-pointer ${
                activeId === config.id ? "bg-accent" : "hover:bg-accent/50"
              }`}
              onClick={() => handleConnect(config.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Database
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
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
                    statusMap[config.id] === "connected"
                      ? "bg-green-500"
                      : statusMap[config.id] === "connecting"
                        ? "bg-yellow-500"
                        : statusMap[config.id] === "error"
                          ? "bg-red-500"
                          : "bg-gray-400"
                  }`}
                />
                {statusMap[config.id] === "connected" ? (
                  <button
                    className="p-1 rounded hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDisconnect(config.id);
                    }}
                  >
                    <Unplug size={14} />
                  </button>
                ) : (
                  <button
                    className="p-1 rounded hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleConnect(config.id);
                    }}
                  >
                    <Plug size={14} />
                  </button>
                )}
                <button
                  className="p-1 rounded hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(config);
                    setShowForm(true);
                  }}
                >
                  <Edit2 size={14} />
                </button>
                <button
                  className="p-1 rounded hover:bg-accent text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(config.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )}
        />
      </div>
      {showForm && (
        <ConnectionForm config={editing} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}

function ConnectionForm({
  config,
  onClose,
}: {
  config: ConnectionConfig | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("connections");
  const saveConfig = useConnectionStore((s) => s.saveConfig);

  const [form, setForm] = useState<ConnectionConfig>(
    config ?? {
      id: crypto.randomUUID(),
      name: "",
      type: "mysql",
      host: "localhost",
      port: 3306,
      username: "root",
      password: "",
      database: "",
      maxConnections: 10,
      sslMode: "disabled",
    },
  );

  const handleSave = async () => {
    const payload = { ...form };
    if (!payload.password || payload.password.trim() === "") {
      delete payload.password;
    }
    await saveConfig(payload);
    onClose();
  };

  const handleTest = async () => {
    try {
      const version = await connectionService.testConnection(form);
      alert(t("testSuccess") + ": " + version);
    } catch (err) {
      alert(
        t("testFailed") +
          ": " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  };

  return (
    <div className="absolute inset-0 bg-background/95 z-50 flex flex-col p-4 gap-3 overflow-auto">
      <h3 className="text-lg font-semibold">
        {config ? t("editConnection") : t("newConnection")}
      </h3>
      <FormField
        label={t("name")}
        value={form.name}
        onChange={(v) => setForm({ ...form, name: v })}
      />
      <FormField
        label={t("host")}
        value={form.host}
        onChange={(v) => setForm({ ...form, host: v })}
      />
      <FormField
        label={t("port")}
        value={String(form.port)}
        onChange={(v) => setForm({ ...form, port: Number(v) })}
        type="number"
      />
      <FormField
        label={t("username")}
        value={form.username}
        onChange={(v) => setForm({ ...form, username: v })}
      />
      <FormField
        label={t("password")}
        value={form.password ?? ""}
        onChange={(v) => setForm({ ...form, password: v })}
        type="password"
      />
      <FormField
        label={t("database")}
        value={form.database ?? ""}
        onChange={(v) => setForm({ ...form, database: v })}
      />
      <div className="flex gap-2 mt-auto">
        <button
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm"
          onClick={handleSave}
        >
          {t("save")}
        </button>
        <button
          className="px-3 py-1.5 border border-border rounded text-sm"
          onClick={handleTest}
        >
          {t("test")}
        </button>
        <button
          className="px-3 py-1.5 border border-border rounded text-sm"
          onClick={onClose}
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        className="px-2 py-1 bg-background border border-border rounded text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
