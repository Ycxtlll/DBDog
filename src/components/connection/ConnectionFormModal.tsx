import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, CheckCircle2, XCircle } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import * as connectionService from "../../services/connectionService";
import { parseTauriError } from "../../lib/error";
import type { ConnectionConfig } from "../../types";

interface ConnectionFormModalProps {
  config: ConnectionConfig | null;
  onClose: () => void;
}

export function ConnectionFormModal({ config, onClose }: ConnectionFormModalProps) {
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
  const [testMsg, setTestMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    const payload = { ...form };
    if (!payload.password || payload.password.trim() === "") {
      delete payload.password;
    }
    await saveConfig(payload);
    onClose();
  };

  const handleTest = async () => {
    setTestMsg(null);
    try {
      const version = await connectionService.testConnection(form);
      setTestMsg({ type: "success", text: `${t("testSuccess")}: ${version}` });
    } catch (err) {
      setTestMsg({
        type: "error",
        text: `${t("testFailed")}: ${parseTauriError(err)}`,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-[90vw] max-h-[85vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted">
          <h3 className="text-base font-semibold text-foreground">
            {config ? t("editConnection") : t("newConnection")}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("cancel")}
          >
            <X size={18} />
          </button>
        </div>


        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
          {/* Type selector */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t("type") ?? "Type"}
            </label>
            <div className="flex gap-2">
              {(["mysql", "memcached"] as const).map((dt) => (
                <button
                  key={dt}
                  className={`px-4 py-2 text-sm rounded-md border transition-colors ${
                    form.type === dt
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-accent text-muted-foreground"
                  }`}
                  onClick={() =>
                    setForm({
                      ...form,
                      type: dt,
                      port: dt === "memcached" ? 11211 : 3306,
                    })
                  }
                >
                  {dt === "memcached" ? "Memcached" : "MySQL"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3">
              <FormField
                label={t("name")}
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                placeholder={t("namePlaceholder")}
                autoFocus
              />
            </div>
            <div className="col-span-2">
              <FormField
                label={t("host")}
                value={form.host}
                onChange={(v) => setForm({ ...form, host: v })}
                placeholder="localhost"
              />
            </div>
            <div className="col-span-1">
              <FormField
                label={t("port")}
                value={String(form.port)}
                onChange={(v) => {
                  const num = Number(v);
                  setForm({ ...form, port: Number.isNaN(num) ? 0 : num });
                }}
                type="number"
              />
            </div>
            {form.type === "mysql" && (
              <>
                <div className="col-span-3 sm:col-span-1.5">
                  <FormField
                    label={t("username")}
                    value={form.username}
                    onChange={(v) => setForm({ ...form, username: v })}
                    placeholder="root"
                  />
                </div>
                <div className="col-span-3 sm:col-span-1.5">
                  <FormField
                    label={t("password")}
                    value={form.password ?? ""}
                    onChange={(v) => setForm({ ...form, password: v })}
                    type="password"
                  />
                </div>
                <div className="col-span-3">
                  <FormField
                    label={t("database")}
                    value={form.database ?? ""}
                    onChange={(v) => setForm({ ...form, database: v })}
                    placeholder={t("databasePlaceholder")}
                  />
                </div>
              </>
            )}
          </div>

          {testMsg && (
            <div
              className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm ${
                testMsg.type === "success"
                  ? "bg-green-500/10 text-green-600 border border-green-500/20"
                  : "bg-destructive/10 text-destructive border border-destructive/20"
              }`}
            >
              {testMsg.type === "success" ? (
                <CheckCircle2 size={16} />
              ) : (
                <XCircle size={16} />
              )}
              <span className="break-all">{testMsg.text}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted">
          <button
            className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors"
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          <button
            className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors"
            onClick={handleTest}
          >
            {t("test")}
          </button>
          <button
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={handleSave}
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        className="px-3 py-2 bg-background border border-border rounded-md text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}
