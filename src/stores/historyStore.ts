import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { QueryHistoryEntry, Bookmark } from '../types/history';

interface HistoryState {
  history: QueryHistoryEntry[];
  bookmarks: Bookmark[];
  folders: string[];
  loading: boolean;
  loadHistory: (connectionId?: string) => Promise<void>;
  searchHistory: (query: string) => Promise<void>;
  addHistoryEntry: (entry: Omit<QueryHistoryEntry, 'id' | 'createdAt'>) => Promise<number>;
  loadBookmarks: (folder?: string) => Promise<void>;
  loadFolders: () => Promise<void>;
  createBookmark: (bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>;
  updateBookmark: (bookmark: Bookmark) => Promise<void>;
  deleteBookmark: (id: number) => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  bookmarks: [],
  folders: [],
  loading: false,

  loadHistory: async (connectionId) => {
    set({ loading: true });
    try {
      const history = await invoke<QueryHistoryEntry[]>('get_history', {
        connectionId,
        limit: 100,
        offset: 0,
      });
      set({ history, loading: false });
    } catch (e) {
      console.error('Failed to load history:', e);
      set({ loading: false });
    }
  },

  searchHistory: async (query) => {
    set({ loading: true });
    try {
      const history = await invoke<QueryHistoryEntry[]>('search_history', {
        query,
        limit: 50,
      });
      set({ history, loading: false });
    } catch (e) {
      console.error('Failed to search history:', e);
      set({ loading: false });
    }
  },

  addHistoryEntry: async (entry) => {
    try {
      const id = await invoke<number>('add_history_entry', { entry });
      // Reload history to include the new entry
      get().loadHistory();
      return id;
    } catch (e) {
      console.error('Failed to add history entry:', e);
      throw e;
    }
  },

  loadBookmarks: async (folder) => {
    set({ loading: true });
    try {
      const bookmarks = await invoke<Bookmark[]>('get_bookmarks', { folder });
      set({ bookmarks, loading: false });
    } catch (e) {
      console.error('Failed to load bookmarks:', e);
      set({ loading: false });
    }
  },

  loadFolders: async () => {
    try {
      const folders = await invoke<string[]>('get_bookmark_folders');
      set({ folders });
    } catch (e) {
      console.error('Failed to load folders:', e);
    }
  },

  createBookmark: async (bookmark) => {
    try {
      const id = await invoke<number>('create_bookmark', { bookmark });
      get().loadBookmarks();
      get().loadFolders();
      return id;
    } catch (e) {
      console.error('Failed to create bookmark:', e);
      throw e;
    }
  },

  updateBookmark: async (bookmark) => {
    try {
      await invoke<void>('update_bookmark', { bookmark });
      get().loadBookmarks();
    } catch (e) {
      console.error('Failed to update bookmark:', e);
      throw e;
    }
  },

  deleteBookmark: async (id) => {
    try {
      await invoke<void>('delete_bookmark', { id });
      get().loadBookmarks();
      get().loadFolders();
    } catch (e) {
      console.error('Failed to delete bookmark:', e);
      throw e;
    }
  },
}));
