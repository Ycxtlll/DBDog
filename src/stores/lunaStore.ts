import { create } from "zustand";

/**
 * Luna's session state — the resident dog's memory for one app run.
 * Diary counters are plain numbers (no persistence: each day with DBDog
 * starts a fresh diary), and `bark` is a one-line speech channel any
 * feature can use when Luna should react to what just happened.
 */
interface LunaState {
  /** One-line remark currently shown by the footer (auto-clears). */
  bark: string | null;
  /** Today's diary: queries run, rows fetched, rows edited, dangerous ops intercepted. */
  diary: { queries: number; rows: number; edits: number; blocked: number };
  sayBark: (line: string) => void;
  clearBark: () => void;
  countQuery: (rows: number) => void;
  countEdits: (n: number) => void;
  countBlocked: () => void;
}

let barkTimer: ReturnType<typeof setTimeout> | null = null;

export const useLunaStore = create<LunaState>()((set) => ({
  bark: null,
  diary: { queries: 0, rows: 0, edits: 0, blocked: 0 },
  sayBark: (line) => {
    set({ bark: line });
    if (barkTimer) clearTimeout(barkTimer);
    barkTimer = setTimeout(() => set({ bark: null }), 3200);
  },
  clearBark: () => {
    if (barkTimer) clearTimeout(barkTimer);
    barkTimer = null;
    set({ bark: null });
  },
  countQuery: (rows) =>
    set((s) => ({
      diary: {
        ...s.diary,
        queries: s.diary.queries + 1,
        rows: s.diary.rows + rows,
      },
    })),
  countEdits: (n) =>
    set((s) => ({ diary: { ...s.diary, edits: s.diary.edits + n } })),
  countBlocked: () =>
    set((s) => ({ diary: { ...s.diary, blocked: s.diary.blocked + 1 } })),
}));
