import React, { useState, useEffect, useCallback } from 'react';
import { Search, Database, Table, Columns, ArrowRight } from 'lucide-react';
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
      <div className="p-3" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="panel-search">
          <Search size={14} className="text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common:search_placeholder')}
            autoFocus
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading && (
          <div className="empty-state">
            <div className="animate-spin text-tertiary">⟳</div>
          </div>
        )}

        {!loading && results.length === 0 && query.trim().length >= 2 && (
          <div className="empty-state">
            <div className="empty-state-title">{t('common:no_results')}</div>
            <div className="empty-state-desc">Try a different search term</div>
          </div>
        )}

        {!loading && query.trim().length < 2 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search size={20} />
            </div>
            <div className="empty-state-title">Search Schema</div>
            <div className="empty-state-desc">Type at least 2 characters to search databases, tables, and columns</div>
          </div>
        )}

        {!loading && (
          <div className="space-y-0.5">
            {results.map((hit, index) => (
              <div
                key={index}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-hover transition-all"
                onClick={() => handleSelect(hit)}
              >
                <div className="flex-shrink-0">
                  {hit.object_type === 'database' && <Database size={15} className="text-secondary" />}
                  {hit.object_type === 'table' && <Table size={15} className="text-secondary" />}
                  {hit.object_type === 'column' && <Columns size={15} className="text-tertiary" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="truncate text-primary text-sm font-medium">{hit.object_name}</div>
                  {hit.parent ? (
                    <div className="truncate text-tertiary text-[11px]">
                      {hit.parent} · {hit.database}
                    </div>
                  ) : (
                    <div className="truncate text-tertiary text-[11px]">{hit.database}</div>
                  )}
                </div>

                <ArrowRight size={14} className="text-tertiary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
