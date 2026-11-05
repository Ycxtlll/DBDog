import { create } from "zustand";
import { persist } from "zustand/middleware";
import { generateId } from "../lib/utils";
import type { Snippet } from "../types";

interface SnippetsState {
  snippets: Snippet[];
  add: (name: string, sql: string) => Snippet;
  update: (id: string, name: string, sql: string) => void;
  remove: (id: string) => void;
}

/**
 * Named, reusable SQL fragments ({{param}} tokens are filled in on insert).
 * Persisted locally — snippets are user content, not session state.
 */
export const useSnippetsStore = create<SnippetsState>()(
  persist(
    (set) => ({
      snippets: [],
      add: (name, sql) => {
        const snippet: Snippet = { id: generateId(), name, sql, createdAt: Date.now() };
        set((state) => ({ snippets: [snippet, ...state.snippets] }));
        return snippet;
      },
      update: (id, name, sql) =>
        set((state) => ({
          snippets: state.snippets.map((s) => (s.id === id ? { ...s, name, sql } : s)),
        })),
      remove: (id) =>
        set((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) })),
    }),
    { name: "dbdog-snippets" },
  ),
);
