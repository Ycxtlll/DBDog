import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalFocusOptions {
  /**
   * Whether the modal is currently shown. Modals that stay mounted and
   * return null when closed (e.g. driven by a store flag) must pass this —
   * otherwise the one-shot mount effect runs while the panel is absent and
   * focus management never activates.
   */
  active?: boolean;
  /** Called on Escape. Omit when the modal handles Esc itself (e.g. custom logic). */
  onEscape?: () => void;
  /** Element to focus on open instead of the first control (e.g. a search input). */
  initialFocus?: () => HTMLElement | null;
}

/**
 * Focus management for hand-rolled modals:
 *  - focuses the first meaningful control on open (inputs preferred over
 *    buttons, since the close button usually sits first in the DOM);
 *  - traps Tab/Shift+Tab inside the panel;
 *  - routes Escape to `onEscape` (capture phase, before page-level handlers).
 * The options object is read through a ref, so passing fresh closures every
 * render does not re-run the effect (and re-focus) — safe to inline.
 */
export function useModalFocus(
  panelRef: RefObject<HTMLElement | null>,
  options: ModalFocusOptions = {},
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { active = true } = options;

  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );

    const explicit = optionsRef.current.initialFocus?.();
    const first =
      explicit ??
      focusables().find((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) ??
      focusables()[0] ??
      null;
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      const { onEscape } = optionsRef.current;
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        const activeEl = document.activeElement;
        const inside = panel.contains(activeEl);
        if (e.shiftKey) {
          if (!inside || activeEl === firstItem) {
            e.preventDefault();
            lastItem.focus();
          }
        } else if (!inside || activeEl === lastItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [panelRef, active]);
}
