import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Copy, Trash2, Edit2, Folder, Search, X, Save, Bookmark, Tag } from 'lucide-react';
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

  const groupedBookmarks = filteredBookmarks.reduce((acc, b) => {
    const folder = b.folder || '';
    if (!acc[folder]) acc[folder] = [];
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
      <div className="panel-header">
        <div className="panel-search flex-1 mr-2">
          <Search size={14} className="text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_placeholder')}
          />
        </div>
        <button
          onClick={handleCreateFromCurrent}
          className="toolbar-btn"
          title="New Bookmark"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading && (
          <div className="empty-state">
            <div className="animate-spin text-tertiary">⟳</div>
          </div>
        )}

        {!loading && filteredBookmarks.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Bookmark size={20} />
            </div>
            <div className="empty-state-title">{t('no_results')}</div>
            <div className="empty-state-desc">Save SQL queries as bookmarks for quick access</div>
          </div>
        )}

        {!loading && sortedFolders.map((folder) => (
          <div key={folder} className="mb-3">
            {folder && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 mb-1">
                <Folder size={12} className="text-tertiary" />
                <span className="text-xs font-medium text-secondary">{folder}</span>
              </div>
            )}
            <div className="space-y-0.5">
              {groupedBookmarks[folder].map((bookmark) => (
                <div
                  key={bookmark.id}
                  className="group relative px-2.5 py-2 rounded-lg cursor-pointer text-xs hover:bg-hover transition-all"
                  onClick={() => handleSelect(bookmark.sql)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex-1 truncate font-medium text-primary pr-2">
                      {bookmark.name}
                    </span>
                    <div className="card-actions">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEdit(bookmark); }}
                        className="toolbar-btn p-1"
                        title="Edit"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopy(bookmark.sql); }}
                        className="toolbar-btn p-1"
                        title="Copy"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(bookmark.id); }}
                        className="toolbar-btn p-1 hover:text-error"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="truncate text-secondary opacity-80 font-mono text-[11px]">
                    {bookmark.sql}
                  </div>
                  {bookmark.tags && bookmark.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5">
                      {bookmark.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
                        >
                          <Tag size={8} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bookmark Dialog */}
      {showDialog && (
        <div className="modal-overlay" onClick={() => setShowDialog(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-2">
                <Bookmark size={18} className="text-accent" />
                <h3>{editingBookmark ? 'Edit Bookmark' : 'New Bookmark'}</h3>
              </div>
              <button onClick={() => setShowDialog(false)} className="btn btn-ghost btn-sm p-1">
                <X size={18} />
              </button>
            </div>

            <div className="modal-body space-y-3">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="form-input"
                  placeholder="Bookmark name"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Folder</label>
                <input
                  type="text"
                  value={formData.folder}
                  onChange={(e) => setFormData({ ...formData, folder: e.target.value })}
                  className="form-input"
                  placeholder="Folder name (optional)"
                  list="folder-list"
                />
                <datalist id="folder-list">
                  {folders.map((folder) => (
                    <option key={folder} value={folder} />
                  ))}
                </datalist>
              </div>

              <div className="form-group">
                <label className="form-label">Tags <span className="optional">(comma-separated)</span></label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="form-input"
                  placeholder="tag1, tag2"
                />
              </div>

              <div className="form-group">
                <label className="form-label">SQL</label>
                <textarea
                  value={formData.sql}
                  onChange={(e) => setFormData({ ...formData, sql: e.target.value })}
                  className="form-textarea h-32 font-mono"
                  placeholder="SQL query"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => setShowDialog(false)}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name.trim() || !formData.sql.trim()}
                className="btn btn-primary btn-sm"
              >
                <Save size={14} className="mr-1.5" />
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
