import { useEffect, useState } from "react";

/**
 * Keeps a conditionally-rendered overlay mounted for `ms` after `open` goes
 * false so its exit animation can play. Returns whether to still render;
 * pair with `closing = show && !open` to switch entrance/exit classes.
 * Reopening mid-exit cancels the pending unmount.
 */
export function useDelayedUnmount(open: boolean, ms = 160): boolean {
  const [show, setShow] = useState(open);

  useEffect(() => {
    if (open) {
      setShow(true);
      return;
    }
    if (!show) return;
    const timer = setTimeout(() => setShow(false), ms);
    return () => clearTimeout(timer);
  }, [open, show, ms]);

  return show;
}
