import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Copy, Trash2, Edit2, Folder, Search } from 'lucide-react';
import { useHistoryStore } from '../../stores/historyStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useQueryStore } from '../../stores/queryStore';
import { useTranslation } from 'react-i18next';
import type { Bookmark as BookmarkType } from '../../types/history';

const BookmarkPanel: React.FC = () => {
  const { bookmarks, folders, loading, loadBookmarks, loadFolders, createBookmark, updateBookmark, deleteBookmark } = useHistoryStore();
  const { activeConnectionId } = useConnectionStore();
  const { addTab, setActiveTab, updateTabSql, getActiveTab } = useQueryStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<BookmarkType | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    folder: '',
    tags: '',
    sql: '',
  });
  const { t } = useTranslation('common');

  useEffect(() => {
    loadBookmarks();
    loadFolders();
  }, [loadBookmarks, loadFolders]);

  const handleCreateFromCurrent = useCallback(() => {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.sql.trim()) {
      setFormData({
        name: '',
        folder: '',
        tags: '',
        sql: activeTab.sql,
      });
      setEditingBookmark(null);
      setShowDialog(true);
    }
  }, [getActiveTab]);

  const handleEdit = useCallback((bookmark: BookmarkType) => {
    setFormData({
      name: bookmark.name,
      folder: bookmark.folder || '',
      tags: bookmark.tags?.join(', ') || '',
      sql: bookmark.sql,
    });
    setEditingBookmark(bookmark);
    setShowDialog(true);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      if (editingBookmark) {
        await updateBookmark({
          ...editingBookmark,
          name: formData.name,
          folder: formData.folder || undefined,
          tags: formData.tags ? formData.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
          sql: formData.sql,
        });
      } else {
        await createBookmark({
          name: formData.name,
          folder: formData.folder || undefined,
          tags: formData.tags ? formData.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
          sql: formData.sql,
        });
      }
      setShowDialog(false);
      setFormData({ name: '', folder: '', tags: '', sql: '' });
      setEditingBookmark(null);
    } catch (e) {
      console.error('Failed to save bookmark:', e);
    }
  }, [formData, editingBookmark, createBookmark, updateBookmark]);

  const handleSelect = useCallback((sql: string) => {
    const tabId = addTab(activeConnectionId || undefined);
    setTimeout(() => {
      const { tabs } = useQueryStore.getState();
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        updateTabSql(tabId, sql);
        setActiveTab(tabId);
      }
    }, 0);
  }, [activeConnectionId, addTab, setActiveTab, updateTabSql]);

  const handleCopy = useCallback((sql: string) => {
    navigator.clipboard.writeText(sql);
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    if (window.confirm('Delete this bookmark?')) {
      try {
        await deleteBookmark(id);
      } catch (e) {
        console.error('Failed to delete bookmark:', e);
      }
    }
  }, [deleteBookmark]);

  const filteredBookmarks = bookmarks.filter((b) =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.sql.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group by folder
  const groupedBookmarks = filteredBookmarks.reduce((acc, b) => {
    const folder = b.folder || '';
    if (!acc[folder]) {
      acc[folder] = [];
    }
    acc[folder].push(b);
    return acc;
  }, {} as Record<string, BookmarkType[]>);

  const sortedFolders = Object.keys(groupedBookmarks).sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-sidebar)' }}>
      <div className="flex items-center justify-between p-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="flex items-center gap-1 flex-1">
          <div className="flex items-center gap-2 px-2 py-1 rounded flex-1" style={{ background: 'var(--bg-hover)' }}>
            <Search size={14} style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search_placeholder')}
              className="flex-1 bg-transparent border-none outline-none text-xs"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>
        <button
          onClick={handleCreateFromCurrent}
          className="flex items-center justify-center w-7 h-7 ml-1 rounded"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          title="New Bookmark"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-1">
        {loading && (
          <div className="flex items-center justify-center p-4">
            <div className="animate-spin" style={{ color: 'var(--text-tertiary)' }}>
              ⟳
            </div>
          </div>
        )}

        {!loading && filteredBookmarks.length === 0 && (
          <div className="flex items-center justify-center p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {t('no_results')}
          </div>
        )}

        {!loading && sortedFolders.map((folder) => (
          <div key={folder}>
            {folder && (
              <div className="flex items-center gap-1 px-2 py-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                <Folder size={12} />
                <span>{folder}</span>
              </div>
            )}
            {groupedBookmarks[folder].map((bookmark) => (
              <div
                key={bookmark.id}
                className="px-2 py-1.5 rounded cursor-pointer text-xs"
                onClick={() => handleSelect(bookmark.sql)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="flex-1 truncate font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {bookmark.name}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEdit(bookmark); }}
                      className="flex items-center justify-center w-5 h-5 rounded"
                      style={{ color: 'var(--text-secondary)' }}
                      title="Edit"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopy(bookmark.sql); }}
                      className="flex items-center justify-center w-5 h-5 rounded"
                      style={{ color: 'var(--text-secondary)' }}
                      title="Copy"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(bookmark.id); }}
                      className="flex items-center justify-center w-5 h-5 rounded"
                      style={{ color: 'var(--text-secondary)' }}
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div
                  className="truncate"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {bookmark.sql}
                </div>
                {bookmark.tags && bookmark.tags.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    {bookmark.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1 rounded text-xs"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Bookmark Dialog */}
      {showDialog && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div
            className="p-4 rounded-lg shadow-lg w-full max-w-md"
            style={{ background: 'var(--bg-primary)' }}
          >
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              {editingBookmark ? 'Edit Bookmark' : 'New Bookmark'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-2 py-1 rounded text-xs border"
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    borderColor: 'var(--border-primary)',
                  }}
                />
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Folder
                </label>
                <input
                  type="text"
                  value={formData.folder}
                  onChange={(e) => setFormData({ ...formData, folder: e.target.value })}
                  className="w-full px-2 py-1 rounded text-xs border"
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    borderColor: 'var(--border-primary)',
                  }}
                  list="folder-list"
                />
                <datalist id="folder-list">
                  {folders.map((folder) => (
                    <option key={folder} value={folder} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="w-full px-2 py-1 rounded text-xs border"
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    borderColor: 'var(--border-primary)',
                  }}
                />
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  SQL
                </label>
                <textarea
                  value={formData.sql}
                  onChange={(e) => setFormData({ ...formData, sql: e.target.value })}
                  className="w-full px-2 py-1 rounded text-xs border h-32 resize-none"
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    borderColor: 'var(--border-primary)',
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowDialog(false)}
                className="px-3 py-1.5 rounded text-xs"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name.trim() || !formData.sql.trim()}
                className="px-3 py-1.5 rounded text-xs font-medium"
                style={{
                  background: formData.name.trim() && formData.sql.trim() ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: formData.name.trim() && formData.sql.trim() ? 'var(--text-inverse)' : 'var(--text-tertiary)',
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookmarkPanel;
