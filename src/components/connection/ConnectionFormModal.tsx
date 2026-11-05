import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, CheckCircle2, XCircle } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import * as connectionService from "../../services/connectionService";
import { translateTauriError } from "../../lib/error";
import { showError } from "../../stores/toastStore";
import type { ConnectionConfig, DiagnosticStep } from "../../types";
import { Checkbox } from "../ui/Checkbox";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";

interface ConnectionFormModalProps {
  /** Stays mounted while the exit animation plays; controls visibility. */
  open: boolean;
  config: ConnectionConfig | null;
  onClose: () => void;
}

function makeDefaultForm(): ConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "mysql",
    host: "",
    port: 3306,
    username: "",
    password: "",
    database: "",
    maxConnections: 10,
    sslMode: "disabled",
  };
}

export function ConnectionFormModal({ open, config, onClose }: ConnectionFormModalProps) {
  const { t } = useTranslation("connections");
  const saveConfig = useConnectionStore((s) => s.saveConfig);

  const [form, setForm] = useState<ConnectionConfig>(config ?? makeDefaultForm());
  const [testMsg, setTestMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [clearPassword, setClearPassword] = useState(false);
  const [diagSteps, setDiagSteps] = useState<DiagnosticStep[] | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active: open, onEscape: onClose });

  // The modal stays mounted for the exit animation — restore a clean form
  // every time it is (re)opened, matching the old fresh-mount behavior.
  useEffect(() => {
    if (open) {
      setForm(config ?? makeDefaultForm());
      setTestMsg(null);
      setClearPassword(false);
      setDiagSteps(null);
    }
  }, [open, config]);

  const show = useDelayedUnmount(open);
  const closing = show && !open;
  if (!show) return null;

  const hasSavedPassword = !!config?.passwordHash;
  const portValid = Number.isInteger(form.port) && form.port >= 1 && form.port <= 65535;
  const formValid = form.name.trim() !== "" && form.host.trim() !== "" && portValid;

  const buildPayload = (): ConnectionConfig => {
    const payload = { ...form };
    if (clearPassword) {
      // Explicit empty password tells the backend to drop the stored
      // credential (None means "keep the existing one").
      payload.password = "";
    } else if (!payload.password || payload.password.trim() === "") {
      delete payload.password;
    }
    return payload;
  };

  const handleSave = async () => {
    try {
      await saveConfig(buildPayload());
      onClose();
    } catch (err) {
      showError(translateTauriError(err, t));
      console.error("Failed to save connection:", err);
    }
  };

  const handleTest = async () => {
    setTestMsg(null);
    try {
      const version = await connectionService.testConnection(buildPayload());
      setTestMsg({ type: "success", text: `${t("testSuccess")}: ${version}` });
    } catch (err) {
      setTestMsg({
        type: "error",
        text: `${t("testFailed")}: ${translateTauriError(err, t)}`,
      });
    }
  };

  // Step-by-step connection doctor (MySQL only): resolve → TCP → handshake
  // → auth → grants, stopping at the first failure with the exact cause.
  const handleDiagnose = async () => {
    setDiagSteps(null);
    setDiagLoading(true);
    try {
      setDiagSteps(await connectionService.diagnoseConnection(buildPayload()));
    } catch (err) {
      setDiagSteps([]);
      showError(translateTauriError(err, t));
    } finally {
      setDiagLoading(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
    >
      <div
        ref={panelRef}
        className={`w-[480px] max-w-[90vw] max-h-[85vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col ${closing ? "animate-modal-out" : "animate-modal-in"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted">
          <h3 className="text-base font-semibold text-foreground">
            {config ? t("editConnection") : t("newConnection")}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
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
              {(["mysql", "postgresql", "memcached", "zookeeper"] as const).map((dt) => (
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
                      port:
                        dt === "memcached" ? 11211
                        : dt === "zookeeper" ? 2181
                        : dt === "postgresql" ? 5432
                        : 3306,
                    })
                  }
                >
                  {dt === "memcached" ? "Memcached" : dt === "zookeeper" ? "ZooKeeper" : dt === "postgresql" ? "PostgreSQL" : "MySQL"}
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
                    onChange={(v) => {
                      setForm({ ...form, password: v });
                      setClearPassword(false);
                    }}
                    type="password"
                  />
                  {hasSavedPassword && (
                    <Checkbox
                      className="mt-1 text-[11px] text-muted-foreground w-fit"
                      checked={clearPassword}
                      onChange={(e) => {
                        setClearPassword(e.target.checked);
                        if (e.target.checked) setForm({ ...form, password: "" });
                      }}
                    >
                      {t("clearSavedPassword")}
                    </Checkbox>
                  )}
                  {hasSavedPassword && !clearPassword && !form.password && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("passwordKeepHint")}
                    </p>
                  )}
                </div>
                <div className="col-span-3">
                  <FormField
                    label={t("database")}
                    value={form.database ?? ""}
                    onChange={(v) => setForm({ ...form, database: v })}
                    placeholder={t("databasePlaceholder")}
                  />
                </div>

                {/* SSH tunnel */}
                <div className="col-span-3">
                  <Checkbox
                    checked={!!form.sshEnabled}
                    onChange={(e) => setForm({ ...form, sshEnabled: e.target.checked })}
                  >
                    {t("sshTunnel")}
                  </Checkbox>
                  {form.sshEnabled && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="col-span-2">
                        <FormField
                          label={t("sshHost")}
                          value={form.sshHost ?? ""}
                          onChange={(v) => setForm({ ...form, sshHost: v })}
                          placeholder="jump.example.com"
                        />
                      </div>
                      <div className="col-span-1">
                        <FormField
                          label={t("sshPort")}
                          value={String(form.sshPort ?? 22)}
                          onChange={(v) => {
                            const num = Number(v);
                            setForm({ ...form, sshPort: Number.isNaN(num) ? 22 : num });
                          }}
                          type="number"
                        />
                      </div>
                      <div className="col-span-1">
                        <FormField
                          label={t("sshUser")}
                          value={form.sshUser ?? ""}
                          onChange={(v) => setForm({ ...form, sshUser: v })}
                        />
                      </div>
                      <div className="col-span-2">
                        <FormField
                          label={t("sshKeyPath")}
                          value={form.sshKeyPath ?? ""}
                          onChange={(v) => setForm({ ...form, sshKeyPath: v || undefined })}
                          placeholder="C:\\Users\\me\\.ssh\\id_ed25519"
                        />
                      </div>
                      <p className="col-span-3 text-[11px] text-muted-foreground">
                        {t("sshKeyHint")}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

          {/* Group */}
          <div className="col-span-3">
            <FormField
              label={t("group")}
              value={form.group ?? ""}
              onChange={(v) => setForm({ ...form, group: v || undefined })}
              placeholder={t("groupPlaceholder")}
            />
          </div>
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

          {/* Connection doctor steps (MySQL only) */}
          {(diagLoading || (diagSteps && diagSteps.length > 0)) && (
            <div className="border border-border rounded-md p-3 space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                {t("diagTitle")}
              </div>
              {diagLoading && (
                <div className="text-xs text-muted-foreground">{t("diagRunning")}</div>
              )}
              {diagSteps?.map((step) => (
                <div key={step.name} className="flex items-start gap-2 text-xs">
                  {step.ok ? (
                    <CheckCircle2 size={13} className="text-green-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle size={13} className="text-red-500 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <span className="font-medium">{t(`diagStep${step.name[0]!.toUpperCase()}${step.name.slice(1)}`)}</span>
                    {step.latencyMs !== null && step.latencyMs !== undefined && (
                      <span className="text-muted-foreground ml-1 tabular-nums">{step.latencyMs}ms</span>
                    )}
                    <div className={`break-all ${step.ok ? "text-muted-foreground" : "text-destructive"}`}>
                      {step.detail}
                    </div>
                  </div>
                </div>
              ))}
              {diagSteps?.length === 0 && !diagLoading && (
                <div className="text-xs text-destructive">{t("diagFailed")}</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted">
          <button
            className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          {form.type === "mysql" && (
            <button
              className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleDiagnose}
              disabled={!formValid || diagLoading}
            >
              {t("diagnose")}
            </button>
          )}
          <button
            className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleTest}
            disabled={!formValid}
          >
            {t("test")}
          </button>
          <button
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={!formValid}
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
