import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { Dog, Github, PawPrint } from "lucide-react";
import { useModalFocus } from "../../lib/useModalFocus";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-foreground">{title}</div>
      <div className="space-y-1 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 leading-relaxed">{children}</div>;
}

/**
 * Help center: wired keyboard shortcuts, everyday grid/editor gestures,
 * the two easter eggs, and version/repo info.
 */
export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const { t } = useTranslation("help");
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active: isOpen, onEscape: onClose });
  const show = useDelayedUnmount(isOpen);
  const closing = show && !isOpen;
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, [isOpen]);

  if (!show) return null;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`w-[520px] max-w-[92vw] max-h-[80vh] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col ${closing ? "animate-modal-out" : "animate-modal-in"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted shrink-0">
          <span className="text-sm font-semibold text-foreground">{t("title")}</span>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("common:cancel")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Section title={t("shortcuts")}>
            <Row><Kbd>{mod}</Kbd><Kbd>Enter</Kbd><span>{t("scRunStatement")}</span></Row>
            <Row><Kbd>{mod}</Kbd><Kbd>⇧</Kbd><Kbd>Enter</Kbd><span>{t("scRunAll")}</span></Row>
            <Row><Kbd>{mod}</Kbd><Kbd>K</Kbd><span>{t("scPalette")}</span></Row>
            <Row><Kbd>{mod}</Kbd><Kbd>B</Kbd><span>{t("scSidebar")}</span></Row>
            <Row><Kbd>{mod}</Kbd><Kbd>C</Kbd><span>{t("scCopyCell")}</span></Row>
            <Row><Kbd>{mod}</Kbd><Kbd>Z</Kbd><span>{t("scUndoChangeset")}</span></Row>
          </Section>

          <Section title={t("grid")}>
            <div>{t("gridInlineEdit")}</div>
            <div>{t("gridContextMenu")}</div>
            <div>{t("gridFkJump")}</div>
            <div>{t("gridChangeset")}</div>
            <div>{t("gridNewRow")}</div>
          </Section>

          <Section title={t("skins")}>
            <div>{t("skinsHint")}</div>
          </Section>

          <Section title={t("eggs")}>
            <div className="flex items-start gap-1.5">
              <Dog size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>{t("eggDog")}</span>
            </div>
            <div className="flex items-start gap-1.5 text-muted-foreground/80">
              <PawPrint size={13} className="mt-0.5 shrink-0" />
              <span>{t("lunaProfile")}</span>
            </div>
          </Section>

          <Section title={t("about")}>
            <Row>
              <span>DBDog {version || "…"}</span>
              <a
                href="https://github.com/Ycxtlll/DBDog"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Github size={12} />
                GitHub
              </a>
            </Row>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-border bg-muted shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            {t("common:cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
