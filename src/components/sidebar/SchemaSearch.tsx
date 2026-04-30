import React, { useState, useEffect, useCallback } from 'react';
import { Search, Database, Table, Columns } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useQueryStore } from '../../stores/queryStore';
import { schemaService } from '../../services/schemaService';
import { useTranslation } from 'react-i18next';
import type { SchemaSearchHit } from '../../types/schema';

export const SchemaSearch: React.FC = () => {
  const { activeConnectionId, activeConnections } = useConnectionStore();
  const { addTab, setActiveTab } = useQueryStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SchemaSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation(['common', 'connections']);

  const isConnected = activeConnectionId && activeConnections.has(activeConnectionId);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!activeConnectionId || searchQuery.trim().length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const hits = await schemaService.searchSchema(activeConnectionId, searchQuery.trim());
      setResults(hits);
    } catch (e) {
      console.error('Search failed:', e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, performSearch]);

  const handleSelect = (hit: SchemaSearchHit) => {
    if (!activeConnectionId) return;

    let sql = '';
    if (hit.object_type === 'table') {
      sql = `SELECT * FROM \`${hit.database}\`.\`${hit.object_name}\` LIMIT 100;`;
    } else if (hit.object_type === 'column') {
      sql = `SELECT \`${hit.object_name}\` FROM \`${hit.database}\`.\`${hit.parent}\` LIMIT 100;`;
    }

    if (sql) {
      const tabId = addTab(activeConnectionId, hit.database);
      setTimeout(() => {
        const { tabs, updateTabSql } = useQueryStore.getState();
        const tab = tabs.find(t => t.id === tabId);
        if (tab) {
          updateTabSql(tabId, sql);
          setActiveTab(tabId);
        }
      }, 0);
    }
  };

  if (!isConnected) {
    return null;
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-sidebar)' }}>
      <div className="p-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: 'var(--bg-hover)' }}>
          <Search size={14} style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common:search_placeholder')}
            className="flex-1 bg-transparent border-none outline-none text-xs"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-1">
        {loading && (
          <div className="flex items-center justify-center p-4">
            <div className="animate-spin" style={{ color: 'var(--text-tertiary)' }}>
              ⟳
            </div>
          </div>
        )}

        {!loading && results.length === 0 && query.trim().length >= 2 && (
          <div className="flex items-center justify-center p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {t('common:no_results')}
          </div>
        )}

        {!loading && results.map((hit, index) => (
          <div
            key={index}
            className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs"
            onClick={() => handleSelect(hit)}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {hit.object_type === 'database' && <Database size={14} style={{ color: 'var(--text-secondary)' }} />}
            {hit.object_type === 'table' && <Table size={14} style={{ color: 'var(--text-secondary)' }} />}
            {hit.object_type === 'column' && <Columns size={14} style={{ color: 'var(--text-tertiary)' }} />}

            <div className="flex-1 min-w-0">
              <div className="truncate" style={{ color: 'var(--text-primary)' }}>
                {hit.object_name}
              </div>
              {hit.parent && (
                <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {hit.parent} · {hit.database}
                </div>
              )}
              {!hit.parent && (
                <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {hit.database}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
