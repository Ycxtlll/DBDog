import { useLayoutStore } from "../stores/layoutStore";
import { useUiStore } from "../stores/uiStore";
import { showSuccess } from "../stores/toastStore";
import { Dog, PawPrint } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionPanel } from "../components/sidebar/ConnectionPanel";
import { SchemaTreePanel } from "../components/sidebar/SchemaTreePanel";
import { MemcachedPanel } from "../components/memcached/MemcachedPanel";
import { ZookeeperPanel } from "../components/zookeeper/ZookeeperPanel";

export function Sidebar() {
  const { sidebarVisible, sidebarWidth } = useLayoutStore();

  if (!sidebarVisible) return null;

  return (
    <div
      className="flex flex-col bg-card"
      style={{ width: sidebarWidth, minWidth: 200, maxWidth: 500 }}
    >
      <div className="flex-1 overflow-hidden">
        <SidebarContent />
      </div>
      <DogFooter />
    </div>
  );
}

/** The resident Border Collie. Pet it for moral support; it has opinions
 *  about your skin choice after enough pets. */
function DogFooter() {
  const { t, i18n } = useTranslation("common");
  const setTheme = useUiStore((s) => s.setTheme);
  const petsRef = useRef(0);
  const [mood, setMood] = useState<string | null>(null);

  const pet = () => {
    petsRef.current += 1;
    const n = petsRef.current;
    const zh = i18n.language === "zh";
    const lines = zh
      ? ["汪！", "汪汪！🐾", "尾巴摇成风扇了", "（贴贴）", "边牧已就位，随时开工"]
      : ["Woof!", "Woof woof! 🐾", "Tail at maximum wag", "(leans on you)", "Border Collie ready to work"];
    setMood(lines[Math.min(n - 1, lines.length - 1)]);
    if (n === 7) {
      setTheme("puppy");
      showSuccess(zh ? "被摸爽了，给你换成奶油橙～" : "That hit the spot — Puppy skin on me~");
    }
    setTimeout(() => setMood(null), 2200);
  };

  return (
    <div className="border-t border-border px-3 py-2">
      <button
        onClick={pet}
        className="w-full flex items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent/40 transition-colors"
        title={t("petTheDog")}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
          <Dog size={15} className="text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground leading-tight">
            DBDog
          </span>
          <span className="block text-[10px] text-muted-foreground leading-tight truncate">
            {mood ?? t("borderCollieOnDuty")}
          </span>
        </span>
        {mood && <PawPrint size={12} className="text-primary shrink-0" />}
      </button>
    </div>
  );
}

function SidebarContent() {
  const { sidebarView } = useLayoutStore();

  if (sidebarView === "schema") {
    return <SchemaTreePanel />;
  }
  if (sidebarView === "memcached") {
    return <MemcachedPanel />;
  }
  if (sidebarView === "zookeeper") {
    return <ZookeeperPanel />;
  }
  return <ConnectionPanel />;
}
