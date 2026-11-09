import { useEffect, useRef, useState } from "react";
import { Dog, User } from "lucide-react";
import i18n from "../../lib/i18n";
import { useLunaStore } from "../../stores/lunaStore";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";

interface TugOfWarModalProps {
  open: boolean;
  onClose: () => void;
}

type Phase = "ready" | "playing" | "won" | "lost";

/**
 * Pure-play tug-of-war with Luna (her favorite hobby). Hold the pull
 * button — she starts gentle but ramps up hard after a few seconds, so
 * hesitating loses the rope. Physics are time-based and deterministic;
 * nobody's database gets touched.
 */
export function TugOfWarModal({ open, onClose }: TugOfWarModalProps) {
  const zh = i18n.language === "zh";
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active: open, onEscape: onClose });
  const show = useDelayedUnmount(open);
  const closing = show && !open;

  const [phase, setPhase] = useState<Phase>("ready");
  const [knot, setKnot] = useState(50);
  const knotRef = useRef(50);
  const pullingRef = useRef(false);
  const rafRef = useRef(0);
  const sayBark = useLunaStore((s) => s.sayBark);

  const stopLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  };

  const startRound = () => {
    stopLoop();
    knotRef.current = 50;
    setKnot(50);
    pullingRef.current = false;
    setPhase("playing");
    let last = performance.now();
    const start = last;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;
      // Luna pulls gently at first, then really digs in — commit early.
      const lunaPull = 18 + Math.min(42, t * 7);
      const delta = (pullingRef.current ? 46 : 0) - lunaPull;
      knotRef.current = Math.max(2, Math.min(98, knotRef.current + delta * dt));
      setKnot(knotRef.current);
      if (knotRef.current >= 96) {
        setPhase("won");
        sayBark(zh ? "汪呜…你力气好大（哼，其实我让的）🐾" : "Ruff… you're strong (I totally let you win) 🐾");
        return;
      }
      if (knotRef.current <= 4) {
        setPhase("lost");
        sayBark(zh ? "汪汪！绳子是我的了！" : "Woof woof! The rope is mine!");
        return;
      }
      if (t > 12) {
        const ahead = knotRef.current >= 50;
        setPhase(ahead ? "won" : "lost");
        sayBark(
          ahead
            ? zh ? "时间到——这局算你的 🐾" : "Time! This round is yours 🐾"
            : zh ? "汪汪！绳子是我的了！" : "Woof woof! The rope is mine!",
        );
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  // Stop the loop when the modal closes or unmounts.
  useEffect(() => {
    if (!open) stopLoop();
    return stopLoop;
  }, [open]);

  if (!show) return null;

  const resultLine =
    phase === "won"
      ? zh ? "你赢了！露娜不服气地摇尾巴" : "You win! Luna wags her tail, unconvinced"
      : phase === "lost"
        ? zh ? "露娜赢了！得意地叼着绳子跑了两圈" : "Luna wins! She parades the rope around twice"
        : null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`w-[340px] max-w-[92vw] bg-card border border-border rounded-lg shadow-2xl ${closing ? "animate-modal-out" : "animate-modal-in"}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
          <span className="text-sm font-semibold text-foreground">
            {zh ? "和露娜拔河 🪢" : "Tug-of-war with Luna 🪢"}
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label={zh ? "关闭" : "Close"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* The rope */}
          <div className="relative h-10 rounded-md bg-muted overflow-hidden">
            <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-border" />
            <Dog size={16} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <User size={16} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <div
              className="absolute top-1/2 h-2.5 rounded-full bg-primary"
              style={{ left: `${knot}%`, width: 26, transform: "translate(-50%, -50%)" }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{zh ? "露娜这头" : "Luna's end"}</span>
            <span>{zh ? "把你这头拉过中线就输啦" : "She drags it across and you lose"}</span>
            <span>{zh ? "你这头" : "Your end"}</span>
          </div>

          {resultLine && (
            <div className="text-xs text-foreground bg-muted rounded-md px-2 py-1.5">{resultLine}</div>
          )}

          <div className="flex items-center gap-2">
            {phase === "playing" ? (
              <button
                onPointerDown={() => {
                  pullingRef.current = true;
                }}
                onPointerUp={() => {
                  pullingRef.current = false;
                }}
                onPointerLeave={() => {
                  pullingRef.current = false;
                }}
                onContextMenu={(e) => e.preventDefault()}
                className="flex-1 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors select-none touch-none"
              >
                {zh ? "按住拉！💪" : "Hold to pull! 💪"}
              </button>
            ) : (
              <button
                onClick={startRound}
                className="flex-1 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {phase === "ready"
                  ? zh ? "开拔！" : "Start pulling!"
                  : zh ? "再拔一次" : "One more round"}
              </button>
            )}
          </div>
          {phase === "playing" && (
            <div className="text-[11px] text-muted-foreground text-center">
              {zh ? "她前几秒是让着你的……" : "She goes easy on you for the first seconds…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
