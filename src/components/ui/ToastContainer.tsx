import { X, AlertCircle, CheckCircle, Info } from "lucide-react";
import { useToastStore, type ToastType } from "../../stores/toastStore";

const typeConfig: Record<
  ToastType,
  { icon: typeof AlertCircle; border: string; bg: string; iconColor: string }
> = {
  error: {
    icon: AlertCircle,
    border: "border-destructive",
    bg: "bg-destructive/5",
    iconColor: "text-destructive",
  },
  success: {
    icon: CheckCircle,
    border: "border-green-500",
    bg: "bg-green-500/5",
    iconColor: "text-green-500",
  },
  info: {
    icon: Info,
    border: "border-blue-500",
    bg: "bg-blue-500/5",
    iconColor: "text-blue-500",
  },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-8 right-4 z-[100] flex flex-col gap-2 max-w-[400px]">
      {toasts.map((toast) => {
        const config = typeConfig[toast.type];
        const Icon = config.icon;
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 px-4 py-3 rounded-lg border shadow-lg ${config.border} ${config.bg} animate-in slide-in-from-right fade-in duration-200`}
          >
            <Icon size={18} className={`shrink-0 mt-0.5 ${config.iconColor}`} />
            <div className="flex-1 min-w-0">
              {toast.title && (
                <div className="text-sm font-medium text-foreground">
                  {toast.title}
                </div>
              )}
              <div className="text-sm text-foreground break-words whitespace-pre-wrap">
                {toast.message}
              </div>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-0.5 rounded hover:bg-black/5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
