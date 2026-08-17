import { X, AlertCircle, CheckCircle, Info } from "lucide-react";
import { useToastStore, type ToastType } from "../../stores/toastStore";

const typeConfig: Record<
  ToastType,
  {
    icon: typeof AlertCircle;
    border: string;
    bg: string;
    iconColor: string;
    label: string;
  }
> = {
  error: {
    icon: AlertCircle,
    border: "border-l-[3px] border-l-destructive border-border",
    bg: "bg-card",
    iconColor: "text-destructive",
    label: "Error",
  },
  success: {
    icon: CheckCircle,
    border: "border-l-[3px] border-l-emerald-500 border-border",
    bg: "bg-card",
    iconColor: "text-emerald-500",
    label: "Success",
  },
  info: {
    icon: Info,
    border: "border-l-[3px] border-l-blue-500 border-border",
    bg: "bg-card",
    iconColor: "text-blue-500",
    label: "Info",
  },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[100] flex flex-col gap-2 max-w-[360px]">
      {toasts.map((toast, i) => {
        const config = typeConfig[toast.type];
        const Icon = config.icon;
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 px-3.5 py-3 rounded-md border shadow-md ${config.border} ${config.bg} animate-toast-in`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <Icon size={16} className={`shrink-0 mt-px ${config.iconColor}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                {toast.title || config.label}
              </div>
              <div className="text-sm text-foreground leading-snug break-words">
                {toast.message}
              </div>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
