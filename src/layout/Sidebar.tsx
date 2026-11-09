import { useLayoutStore } from "../stores/layoutStore";
import { useUiStore } from "../stores/uiStore";
import { useQueryStore } from "../stores/queryStore";
import { useLunaStore } from "../stores/lunaStore";
import { showSuccess } from "../stores/toastStore";
import { BookOpen, Dog, PawPrint } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
 *  about your skin choice after enough pets, and clicking toggles her
 *  work diary — a session tally of what you and she did together. */
function DogFooter() {
  const { t, i18n } = useTranslation("common");
  const setTheme = useUiStore((s) => s.setTheme);
  const petsRef = useRef(0);
  const [mood, setMood] = useState<string | null>(null);
  const [showDiary, setShowDiary] = useState(false);
  const [chewingLong, setChewingLong] = useState(false);
  const bark = useLunaStore((s) => s.bark);
  const diary = useLunaStore((s) => s.diary);
  const activeTab = useQueryStore((s) =>
    s.tabs.find((tab) => tab.id === s.activeTabId),
  );
  const zh = i18n.language === "zh";

  // Long query: swap the chase line after ~4s of continuous execution —
  // a big table fetch deserves a different attitude.
  const executing = !!activeTab?.isExecuting;
  useEffect(() => {
    if (!executing) {
      setChewingLong(false);
      return;
    }
    const timer = setTimeout(() => setChewingLong(true), 4000);
    return () => clearTimeout(timer);
  }, [executing]);

  // The dog mirrors real app state — the footer doubles as a status lamp.
  // Petting and her speech channel override it for a moment.
  const status = (() => {
    if (!activeTab) return { text: t("borderCollieOnDuty"), working: false };
    if (activeTab.isExecuting)
      return chewingLong
        ? { text: zh ? "这块骨头有点大，还在啃… 🦴" : "This bone is huge — still chewing… 🦴", working: true }
        : { text: zh ? "追球中… 🎾" : "Chasing the ball… 🎾", working: true };
    if (activeTab.error) {
      const lines = zh
        ? ["呜…出错了（看状态栏）", "呜…这根骨头咬不动（看状态栏）"]
        : ["Whimper… check the status bar", "Whimper… this bone won't chew (status bar)"];
      return { text: lines[activeTab.error.length % 2], working: false };
    }
    const pending = activeTab.pendingChanges?.length ?? 0;
    if (pending > 0)
      return {
        text: zh ? `嘴里叼着 ${pending} 处修改` : `Holding ${pending} changes in mouth`,
        working: false,
      };
    if (activeTab.lastAppliedRollbacks?.length)
      return { text: zh ? "刚叼来一根骨头 🦴" : "Just fetched a bone 🦴", working: false };
    const rows = activeTab.isQueryResult
      ? (activeTab.tableBrowse?.totalRows ??
        (activeTab.result as { totalCount?: number } | undefined)?.totalCount)
      : (activeTab.result as { rowsAffected?: number } | undefined)?.rowsAffected;
    if (typeof rows === "number")
      return {
        text: zh ? `叼回来 ${rows.toLocaleString()} 行 🦴` : `Fetched ${rows.toLocaleString()} rows 🦴`,
        working: false,
      };
    return { text: t("borderCollieOnDuty"), working: false };
  })();

  const diaryText = (() => {
    const { queries, rows, edits, blocked } = diary;
    if (queries + edits + blocked === 0)
      return zh ? "今天还没开工" : "No work logged yet today";
    const fmtRows =
      rows >= 1_000_000 ? `${(rows / 1_000_000).toFixed(1)}M`
      : rows >= 1000 ? `${(rows / 1000).toFixed(1)}k`
      : String(rows);
    return zh
      ? `日志：${queries} 查 · ${fmtRows} 行 · 改 ${edits} · 拦 ${blocked}`
      : `Log: ${queries} queries · ${fmtRows} rows · ${edits} edits · ${blocked} blocked`;
  })();

  const pet = () => {
    petsRef.current += 1;
    const n = petsRef.current;
    const lines = zh
      ? ["汪！", "汪汪！🐾", "尾巴摇成风扇了", "（贴贴）", "Luna 已就位，随时开工"]
      : ["Woof!", "Woof woof! 🐾", "Tail at maximum wag", "(leans on you)", "Luna ready to work"];
    setMood(lines[Math.min(n - 1, lines.length - 1)]);
    if (n === 7) {
      setTheme("puppy");
      showSuccess(zh ? "被摸爽了，给你换成奶油橙～" : "That hit the spot — Puppy skin on me~");
    }
    setTimeout(() => setMood(null), 2200);
    setShowDiary((d) => !d);
  };

  const line = bark ?? mood ?? (showDiary ? diaryText : status.text);
  const working = !bark && !mood && !showDiary && status.working;

  return (
    <div className="border-t border-border px-3 py-2">
      <button
        onClick={pet}
        className="w-full flex items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent/40 transition-colors"
        title={zh ? "摸摸露娜；再点一下切换工作日志" : "Pet Luna; click again to toggle her work log"}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
          <Dog size={15} className="text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground leading-tight">
            {zh ? "露娜 Luna" : "Luna"}
          </span>
          <span className={`block text-[10px] leading-tight truncate ${
            working ? "text-primary" : "text-muted-foreground"
          }`}>
            {line}
          </span>
        </span>
        {bark ? (
          <PawPrint size={12} className="text-primary shrink-0" />
        ) : showDiary ? (
          <BookOpen size={12} className="text-muted-foreground shrink-0" />
        ) : mood ? (
          <PawPrint size={12} className="text-primary shrink-0" />
        ) : null}
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
