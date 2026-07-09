import { useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import type { UnlistenFn } from "@tauri-apps/api/event";
import * as queryService from "../../services/queryService";
import { parseTauriError } from "../../lib/error";

interface ExportProgress {
  totalRows: number;
  phase: "running" | "done" | "cancelled" | "error";
  error?: string;
}

interface ExportDialogProps {
  connectionId: string;
  database: string;
  table: string;
  onClose: () => void;
}

function defaultPath(database: string, table: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${database}_${table}_${date}.csv`;
}

export function ExportDialog({
  connectionId,
  database,
  table,
  onClose,
}: ExportDialogProps) {
  type Phase = ExportProgress["phase"] | "idle";

  const [totalRows, setTotalRows] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savePath, setSavePath] = useState(defaultPath(database, table));
  const exportIdRef = useRef(crypto.randomUUID());

  const handleChoosePath = useCallback(async () => {
    const chosen = await save({
      defaultPath: savePath,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (chosen) setSavePath(chosen);
  }, [savePath]);

  const handleStart = useCallback(async () => {
    setPhase("running");
    try {
      const unlisten: UnlistenFn = await listen<ExportProgress>(
        "export-progress",
        (event) => {
          if (event.payload.totalRows !== undefined) {
            setTotalRows(event.payload.totalRows);
          }
          setPhase(event.payload.phase);
          if (event.payload.error) {
            setErrorMsg(event.payload.error);
          }
        },
      );

      try {
        await queryService.executeExport(
          connectionId,
          database,
          table,
          savePath,
          exportIdRef.current,
        );
      } catch (err) {
        const msg = parseTauriError(err);
        setErrorMsg(msg);
        setPhase("error");
      }

      unlisten();
    } catch (err) {
      setErrorMsg(parseTauriError(err));
      setPhase("error");
    }
  }, [connectionId, database, table, savePath]);

  const handleCancel = async () => {
    try {
      await queryService.cancelExport(exportIdRef.current);
    } catch { /* ignore */ }
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  const pct = totalRows > 0
    ? Math.min(99, Math.floor(Math.log10(totalRows + 1) * 15))
    : 0;

  const idle = phase === "idle";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={idle ? onClose : undefined}
    >
      <div
        className="w-[460px] max-w-[92vw] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold">
              导出 {database}.{table}
            </h3>
            {phase !== "idle" && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {phase === "running" && `正在导出... 已读取 ${totalRows.toLocaleString()} 行`}
                {phase === "done" && `完成 — 共 ${totalRows.toLocaleString()} 行`}
                {phase === "cancelled" && "已取消"}
                {phase === "error" && "导出失败"}
              </p>
            )}
          </div>
          <button
            onClick={idle ? onClose : handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {/* Idle: show save path + start button */}
          {idle && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">保存位置</p>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md truncate border border-border">
                  {savePath}
                </span>
                <button
                  type="button"
                  onClick={handleChoosePath}
                  className="shrink-0 px-3 py-2 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  选择
                </button>
              </div>
            </div>
          )}

          {/* Running: progress */}
          {phase === "running" && (
            <div className="space-y-3">
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{totalRows.toLocaleString()} 行</span>
                <span>正在导出...</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                保存至：{savePath}
              </p>
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
                导出成功
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {savePath}
              </p>
            </div>
          )}

          {phase === "error" && (
            <p className="text-sm text-destructive py-2">{errorMsg || "未知错误"}</p>
          )}

          {phase === "cancelled" && (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
              导出已取消
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted">
          {idle && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleStart}
                className="px-4 py-1.5 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              >
                开始导出
              </button>
            </>
          )}
          {phase === "running" && (
            <button
              onClick={handleCancel}
              className="px-4 py-1.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
            >
              取消导出
            </button>
          )}
          {(phase === "done" || phase === "error" || phase === "cancelled") && (
            <button
              onClick={handleClose}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
