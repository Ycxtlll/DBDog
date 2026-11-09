import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Maximize2, Network, RefreshCw, X } from "lucide-react";
import { useLayoutStore } from "../../stores/layoutStore";
import { useQueryStore } from "../../stores/queryStore";
import { showSuccess, showError } from "../../stores/toastStore";
import * as relationshipService from "../../services/relationshipService";
import * as queryService from "../../services/queryService";
import { escapeMysqlIdentifier } from "../../lib/sql";
import { parseTauriError } from "../../lib/error";
import { Checkbox } from "../ui/Checkbox";
import { EmptyState } from "../ui/EmptyState";
import { SkeletonLines } from "../ui/Skeleton";
import { RelationshipModal } from "../grid/RelationshipModal";
import type { RelationshipsMap, TableRelationship } from "../../types";

// Must stay in sync with CARD_WIDTH in src-tauri/src/relationships/layout.rs —
// the layout's slot arithmetic assumes the drawn cards use this width.
const CARD_WIDTH = 210;
const HEADER_H = 26;
const ROW_H = 16;
const CARD_PAD = 8;
/** Cards collapse beyond this many column rows ("+N more" toggles). */
const MAX_COLLAPSED = 14;
const MAX_EXPANDED = 40;
/** Above this count, heuristic candidate edges start off (noise guard). */
const CANDIDATE_AUTO_LIMIT = 60;

const visibleRows = (n: number, expanded: boolean) =>
  Math.min(n, expanded ? MAX_EXPANDED : MAX_COLLAPSED);
const hasMore = (n: number, expanded: boolean) =>
  n > (expanded ? MAX_EXPANDED : MAX_COLLAPSED);
/** Drawn card height for the given expand state. */
const cardH = (n: number, expanded: boolean) =>
  HEADER_H + visibleRows(n, expanded) * ROW_H + (hasMore(n, expanded) ? ROW_H : 0) + CARD_PAD;
/** The layout reserves the expanded worst case so expansion never overlaps. */
const cardLayoutH = (n: number) => cardH(n, true);

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

interface Position {
  x: number;
  y: number;
}

const positionsKey = (connectionId: string, database: string) =>
  `dbdog.ermap.${connectionId}.${database}`;

function readPositions(connectionId: string, database: string): Record<string, Position> {
  try {
    return JSON.parse(localStorage.getItem(positionsKey(connectionId, database)) ?? "{}");
  } catch {
    return {};
  }
}

function savePositions(connectionId: string, database: string, positions: Record<string, Position>) {
  try {
    localStorage.setItem(positionsKey(connectionId, database), JSON.stringify(positions));
  } catch {
    // Storage full / unavailable — layout reverts to computed positions.
  }
}

interface ErMapDrawerProps {
  connectionId: string | null;
}

interface PopoverState {
  edge: TableRelationship;
  x: number;
  y: number;
}

type ProbeState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; rate: number }
  | { state: "fail" }
  | { state: "empty" };

/**
 * ER relationship map (M-ER): the relationship analyzer's visual console.
 * Tables are cards, links are bezier edges (solid = declared/confirmed,
 * dashed = name-heuristic candidates awaiting a verdict), and tables with
 * no links park in the isolated zone below — the completion targets.
 * The layered layout itself runs in Rust (`er_layout_compute`); this canvas
 * only draws, pans, zooms and collects user verdicts.
 */
export function ERMapDrawer({ connectionId }: ErMapDrawerProps) {
  const { t } = useTranslation("ermap");
  const { drawer, closeDrawer } = useLayoutStore();
  const open = drawer.type === "erMap";
  const database =
    typeof drawer.params?.database === "string" ? drawer.params.database : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [map, setMap] = useState<RelationshipsMap | null>(null);
  const [layout, setLayout] = useState<import("../../types").ErLayout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transform, setTransform] = useState({ tx: 40, ty: 40, k: 1 });
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showCandidates, setShowCandidates] = useState(true);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [probe, setProbe] = useState<ProbeState>({ state: "idle" });
  const [linking, setLinking] = useState<{
    from: string;
    cur: Position; // client coords
    target: string | null;
  } | null>(null);
  const [relModal, setRelModal] = useState<{
    childTable: string;
    parentTable?: string;
  } | null>(null);

  const transformRef = useRef(transform);
  transformRef.current = transform;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const relModalRef = useRef(relModal);
  relModalRef.current = relModal;
  const popoverRef = useRef(popover);
  popoverRef.current = popover;

  // --- data ----------------------------------------------------------------

  const load = useCallback(async () => {
    if (!connectionId || !database) return;
    setLoading(true);
    setError(null);
    // The drawer component stays mounted across open/close — clear per-view
    // state so reopening on another database starts clean.
    setSearch("");
    setPopover(null);
    setLinking(null);
    setRelModal(null);
    try {
      const m = await relationshipService.getRelationshipsMap(connectionId, database);
      setMap(m);
      const input = m.tables.map((tb) => ({
        name: tb.name,
        height: cardLayoutH(tb.columns.length),
      }));
      const edges = m.edges.map((e) => ({
        childTable: e.childTable,
        parentTable: e.parentTable,
      }));
      const lay = await relationshipService.computeErLayout(input, edges);
      setLayout(lay);
      setExpanded(new Set());
      const saved = readPositions(connectionId, database);
      positionsRef.current = saved;
      setPositions(saved);
      const candidates = m.edges.filter((e) => e.source === "inferred").length;
      setShowCandidates(candidates <= CANDIDATE_AUTO_LIMIT);
      // Ask for a fit once the new layout has rendered.
      requestAnimationFrame(() => fitView(lay));
    } catch (err) {
      setError(parseTauriError(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitView is stable via ref
  }, [connectionId, database]);

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reopen only
  }, [open]);

  // --- viewport ------------------------------------------------------------

  const fitView = useCallback((lay: import("../../types").ErLayout | null) => {
    const el = containerRef.current;
    if (!el || !lay || lay.width <= 0) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (vw <= 0 || vh <= 0) return;
    const k = Math.min((vw - 32) / lay.width, (vh - 32) / lay.height, 1.2);
    setTransform({
      k,
      tx: (vw - lay.width * k) / 2,
      ty: (vh - lay.height * k) / 2,
    });
  }, []);

  // Wheel zoom must be a non-passive listener to preventDefault.
  useEffect(() => {
    const el = svgRef.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setTransform((tr) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const k = Math.min(2.5, Math.max(0.12, tr.k * factor));
        const s = k / tr.k;
        return { k, tx: mx - (mx - tr.tx) * s, ty: my - (my - tr.ty) * s };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, loading, error, map]);

  // Esc: popover/linking first, then the drawer. A relationship modal opened
  // on top handles its own Esc — stay out of its way.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (relModalRef.current) return;
      if (popoverRef.current) {
        setPopover(null);
        return;
      }
      if (linking) {
        setLinking(null);
        return;
      }
      closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, linking, closeDrawer]);

  // --- geometry ------------------------------------------------------------

  const tableMap = useMemo(
    () => new Map((map?.tables ?? []).map((tb) => [tb.name, tb])),
    [map],
  );

  const fkChildCols = useMemo(() => {
    const set = new Set<string>();
    for (const e of map?.edges ?? []) set.add(`${e.childTable}|${e.childColumn}`);
    return set;
  }, [map]);

  const nodes = useMemo(() => {
    if (!layout) return [];
    return layout.nodes.map((n) => {
      const pos = positions[n.table] ?? { x: n.x, y: n.y };
      const cols = tableMap.get(n.table)?.columns.length ?? 0;
      return { ...n, pos, h: cardH(cols, expanded.has(n.table)) };
    });
  }, [layout, positions, tableMap, expanded]);

  const nodeByName = useMemo(() => new Map(nodes.map((n) => [n.table, n])), [nodes]);

  const searchHit = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !map) return null;
    const hit = new Set<string>();
    for (const tb of map.tables) {
      if (tb.name.toLowerCase().includes(q)) hit.add(tb.name);
    }
    // Neighbors of a hit stay lit so the local context survives the dim.
    for (const e of map.edges) {
      if (hit.has(e.childTable) || hit.has(e.parentTable)) {
        hit.add(e.childTable);
        hit.add(e.parentTable);
      }
    }
    return hit;
  }, [search, map]);

  const contentPoint = (clientX: number, clientY: number): Position => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const tr = transformRef.current;
    return { x: (clientX - rect.left - tr.tx) / tr.k, y: (clientY - rect.top - tr.ty) / tr.k };
  };

  const nodeAt = (p: Position): (typeof nodes)[number] | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (p.x >= n.pos.x && p.x <= n.pos.x + CARD_WIDTH && p.y >= n.pos.y && p.y <= n.pos.y + n.h) {
        return n;
      }
    }
    return null;
  };

  const edgePaths = useMemo(() => {
    if (!map) return [];
    const out: {
      e: TableRelationship;
      d: string;
      dim: boolean;
      candidate: boolean;
      selfLoop: boolean;
    }[] = [];
    for (const e of map.edges) {
      if (e.source === "inferred" && !showCandidates) continue;
      const c = nodeByName.get(e.childTable);
      const p = nodeByName.get(e.parentTable);
      if (!c || !p) continue;
      const candidate = e.source === "inferred";
      const selfLoop = c.table.toLowerCase() === p.table.toLowerCase();
      let d: string;
      if (selfLoop) {
        const x = c.pos.x + CARD_WIDTH;
        const y = c.pos.y + HEADER_H + 10;
        d = `M ${x} ${y} C ${x + 48} ${y}, ${x + 48} ${y + 26}, ${x} ${y + 26}`;
      } else {
        const x1 = c.pos.x + CARD_WIDTH / 2;
        const y1 = c.pos.y;
        const x2 = p.pos.x + CARD_WIDTH / 2;
        const y2 = p.pos.y + p.h;
        const my = (y1 + y2) / 2;
        d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
      }
      const dim = !!searchHit && !(searchHit.has(e.childTable) && searchHit.has(e.parentTable));
      out.push({ e, d, dim, candidate, selfLoop });
    }
    return out;
  }, [map, nodeByName, showCandidates, searchHit]);

  // --- interactions ----------------------------------------------------------

  const setPos = (table: string, pos: Position) => {
    positionsRef.current = { ...positionsRef.current, [table]: pos };
    setPositions(positionsRef.current);
  };

  const startPan = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const t0 = { ...transformRef.current };
    const move = (me: MouseEvent) => {
      setTransform({ k: t0.k, tx: t0.tx + (me.clientX - startX), ty: t0.ty + (me.clientY - startY) });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const toggleExpand = (table: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  const startCardDrag = (e: React.MouseEvent, node: (typeof nodes)[number]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setPopover(null);
    const table = node.table;
    const start = { x: e.clientX, y: e.clientY };
    const orig = positionsRef.current[table] ?? { x: node.x, y: node.y };
    let moved = false;
    const move = (me: MouseEvent) => {
      const dx = (me.clientX - start.x) / transformRef.current.k;
      const dy = (me.clientY - start.y) / transformRef.current.k;
      if (!moved && Math.hypot(dx, dy) < 3 / transformRef.current.k) return;
      moved = true;
      setPos(table, { x: orig.x + dx, y: orig.y + dy });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (moved) {
        if (connectionId && database) {
          savePositions(connectionId, database, positionsRef.current);
        }
      } else if (connectionId && database) {
        // Plain click = jump to the table's data browse.
        void useQueryStore.getState().openTable(connectionId, database, table);
        closeDrawer();
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startLink = (e: React.MouseEvent, node: (typeof nodes)[number]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setPopover(null);
    setLinking({ from: node.table, cur: { x: e.clientX, y: e.clientY }, target: null });
    const move = (me: MouseEvent) => {
      const p = contentPoint(me.clientX, me.clientY);
      const hit = nodeAt(p);
      setLinking({
        from: node.table,
        cur: { x: me.clientX, y: me.clientY },
        target: hit && hit.table !== node.table ? hit.table : null,
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setLinking((l) => {
        if (l?.target && connectionId && database) {
          setRelModal({ childTable: l.from, parentTable: l.target });
        }
        return null;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onSvgMouseDown = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target === svgRef.current || target.getAttribute("data-er-bg") === "1") {
      setPopover(null);
      startPan(e);
    }
  };

  // --- edge popover actions --------------------------------------------------

  const runProbe = async () => {
    const edge = popoverRef.current?.edge;
    if (!connectionId || !database || !edge) return;
    setProbe({ state: "loading" });
    try {
      const col = escapeMysqlIdentifier(edge.childColumn);
      const sql = `SELECT DISTINCT ${col} AS v FROM ${escapeMysqlIdentifier(edge.childTable)} WHERE ${col} IS NOT NULL`;
      const res = await queryService.executeQuery(connectionId, sql, 200, database);
      const samples = res.rows
        .map((r) => Object.values(r)[0])
        .filter((v) => v !== null && String(v).trim() !== "")
        .slice(0, 50);
      if (samples.length === 0) {
        setProbe({ state: "empty" });
        return;
      }
      const rate = await relationshipService.probeRelationship(
        connectionId,
        database,
        edge.parentTable,
        edge.parentColumn,
        samples,
      );
      setProbe(rate === null ? { state: "fail" } : { state: "done", rate });
    } catch {
      setProbe({ state: "fail" });
    }
  };

  const adjudicate = async (confirm: boolean) => {
    const edge = popoverRef.current?.edge;
    if (!connectionId || !edge) return;
    try {
      await relationshipService.adjudicateRelationship(
        connectionId,
        {
          childTable: edge.childTable,
          childColumn: edge.childColumn,
          parentTable: edge.parentTable,
          parentColumn: edge.parentColumn,
        },
        confirm,
      );
      setPopover(null);
      showSuccess(t("query:relSaved"));
      void load();
    } catch (err) {
      showError(parseTauriError(err));
    }
  };

  if (!open || !database) return null;

  const stats = (() => {
    if (!map) return null;
    const links = map.edges.filter((e) => e.source !== "inferred").length;
    const guess = map.edges.filter((e) => e.source === "inferred").length;
    const lone = layout?.nodes.filter((n) => n.isolated).length ?? 0;
    return { tables: map.tables.length, links, guess, lone };
  })();

  const sourceLabel = (source: TableRelationship["source"]) =>
    source === "declared"
      ? t("declared")
      : source === "inferred"
        ? t("inferred")
        : t("adjudicated"); // imported lists are stored verdicts too

  const probeBadge = (() => {
    if (probe.state === "loading") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 size={11} className="animate-spin" />
          {t("probing")}
        </span>
      );
    }
    if (probe.state === "idle") return null;
    if (probe.state === "empty") {
      return <span className="text-xs text-muted-foreground">{t("probeNoSamples")}</span>;
    }
    if (probe.state === "fail") {
      return <span className="text-xs text-muted-foreground">{t("probeFail")}</span>;
    }
    const percent = Math.round(probe.rate * 100);
    if (percent >= 80) return <span className="text-xs text-green-600">{t("probeRate", { rate: percent })}</span>;
    if (percent >= 20) return <span className="text-xs text-amber-500">{t("probeRate", { rate: percent })}</span>;
    return <span className="text-xs text-destructive">{t("probeRate", { rate: percent })}</span>;
  })();

  const linkingFrom = linking ? nodeByName.get(linking.from) : null;
  const linkingTarget = linking?.target ? nodeByName.get(linking.target) : null;
  const linkingTo = linking ? contentPoint(linking.cur.x, linking.cur.y) : null;

  return (
    <div ref={containerRef} className="absolute inset-0 z-40 bg-background flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted shrink-0">
        <Network size={15} className="text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground truncate">
          {t("title")} · {database}
        </span>
        {stats && (
          <span className="text-[11px] text-muted-foreground truncate hidden md:inline">
            {t("stats", stats)}
          </span>
        )}
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-44 bg-background border border-border rounded-md px-1.5 py-1 text-xs outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
        />
        <Checkbox checked={showCandidates} onChange={(e) => setShowCandidates(e.target.checked)}>
          <span className="text-xs text-muted-foreground">{t("showCandidates")}</span>
        </Checkbox>
        <button
          onClick={() => fitView(layout)}
          title={t("fit")}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Maximize2 size={14} />
        </button>
        <button
          onClick={() => void load()}
          title={t("refresh")}
          disabled={loading}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <button
          onClick={closeDrawer}
          title={t("close")}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 p-8">
            <SkeletonLines lines={8} />
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState
              icon={<Network size={20} />}
              title={t("loadError")}
              description={error}
              action={{ label: t("retry"), onClick: () => void load() }}
            />
          </div>
        )}
        {!loading && !error && map && map.tables.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState icon={<Network size={20} />} title={t("emptyTitle")} description={t("emptyDesc")} />
          </div>
        )}
        {!loading && !error && map && map.tables.length > 0 && (
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            className="block select-none"
            onMouseDown={onSvgMouseDown}
          >
            <defs>
              <marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-primary" />
              </marker>
              <marker id="er-arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
              </marker>
            </defs>
            <rect width="100%" height="100%" fill="transparent" data-er-bg="1" />
            <g transform={`translate(${transform.tx} ${transform.ty}) scale(${transform.k})`}>
              {/* Edges under cards */}
              {edgePaths.map(({ e, d, dim, candidate, selfLoop }, i) => (
                <g
                  key={`${e.childTable}.${e.childColumn}.${e.parentTable}.${i}`}
                  opacity={dim ? 0.06 : candidate ? 0.75 : 0.95}
                >
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={8}
                    stroke="transparent"
                    pointerEvents="stroke"
                    className="cursor-pointer"
                    onClick={(ev) => {
                      setPopover({ edge: e, x: ev.clientX, y: ev.clientY });
                      setProbe({ state: "idle" });
                    }}
                  >
                    {selfLoop && <title>{t("selfRef")}</title>}
                  </path>
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={candidate ? 1.3 : 1.6}
                    strokeDasharray={candidate ? "5 3" : undefined}
                    className={candidate ? "stroke-muted-foreground pointer-events-none" : "stroke-primary pointer-events-none"}
                    markerEnd={candidate ? "url(#er-arrow-muted)" : "url(#er-arrow)"}
                  />
                </g>
              ))}

              {/* Link-drag rubber band */}
              {linking && linkingFrom && linkingTo && (
                <g className="pointer-events-none">
                  <line
                    x1={linkingFrom.pos.x + CARD_WIDTH}
                    y1={linkingFrom.pos.y + HEADER_H / 2}
                    x2={linkingTo.x}
                    y2={linkingTo.y}
                    className="stroke-primary"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <circle cx={linkingTo.x} cy={linkingTo.y} r={3.5} className="fill-primary" />
                </g>
              )}
              {linkingTarget && (
                <rect
                  x={linkingTarget.pos.x - 2}
                  y={linkingTarget.pos.y - 2}
                  width={CARD_WIDTH + 4}
                  height={linkingTarget.h + 4}
                  rx={8}
                  fill="none"
                  className="stroke-primary pointer-events-none"
                  strokeWidth={2}
                />
              )}

              {/* Table cards */}
              {nodes.map((n) => {
                const cols = tableMap.get(n.table)?.columns ?? [];
                const isExpanded = expanded.has(n.table);
                const shown = visibleRows(cols.length, isExpanded);
                const more = hasMore(cols.length, isExpanded);
                const dim = !!searchHit && !searchHit.has(n.table);
                return (
                  <g
                    key={n.table}
                    className="group cursor-grab"
                    opacity={dim ? 0.15 : 1}
                    onMouseDown={(e) => startCardDrag(e, n)}
                  >
                    <rect
                      x={n.pos.x}
                      y={n.pos.y}
                      width={CARD_WIDTH}
                      height={n.h}
                      rx={6}
                      strokeWidth={1.5}
                      strokeDasharray={n.isolated ? "5 3" : undefined}
                      className={n.isolated ? "fill-card stroke-muted-foreground/70" : "fill-card stroke-border"}
                    />
                    {/* Header band (square the bottom corners) */}
                    <rect
                      x={n.pos.x}
                      y={n.pos.y}
                      width={CARD_WIDTH}
                      height={HEADER_H}
                      rx={6}
                      className="fill-muted pointer-events-none"
                    />
                    <rect
                      x={n.pos.x}
                      y={n.pos.y + HEADER_H - 6}
                      width={CARD_WIDTH}
                      height={6}
                      className="fill-muted pointer-events-none"
                    />
                    <text x={n.pos.x + 10} y={n.pos.y + 17.5} fontSize={12} className="fill-foreground font-semibold pointer-events-none">
                      {truncate(n.table, 22)}
                    </text>
                    <text
                      x={n.pos.x + CARD_WIDTH - 26}
                      y={n.pos.y + 17.5}
                      fontSize={10}
                      textAnchor="end"
                      className="fill-muted-foreground pointer-events-none"
                    >
                      {cols.length}
                    </text>

                    {cols.slice(0, shown).map((col, i) => {
                      const ry = n.pos.y + HEADER_H + i * ROW_H + 11.5;
                      const isFk = fkChildCols.has(`${n.table}|${col.name}`);
                      return (
                        <g key={col.name}>
                          {col.primaryKey && (
                            <circle cx={n.pos.x + 13} cy={ry - 3.5} r={3} className="fill-primary pointer-events-none" />
                          )}
                          {isFk && (
                            <circle
                              cx={n.pos.x + 13}
                              cy={ry - 3.5}
                              r={3}
                              fill="none"
                              className="stroke-primary pointer-events-none"
                              strokeWidth={1.2}
                            />
                          )}
                          <text
                            x={n.pos.x + (col.primaryKey || isFk ? 21 : 10)}
                            y={ry}
                            fontSize={11}
                            className={`pointer-events-none ${
                              col.primaryKey ? "fill-foreground font-semibold" : "fill-foreground/90"
                            }`}
                          >
                            {truncate(col.name, 16)}
                          </text>
                          <text
                            x={n.pos.x + CARD_WIDTH - 8}
                            y={ry}
                            fontSize={9.5}
                            textAnchor="end"
                            className="fill-muted-foreground pointer-events-none"
                          >
                            {truncate(col.dataType, 12)}
                          </text>
                        </g>
                      );
                    })}
                    {more && (
                      <text
                        x={n.pos.x + 10}
                        y={n.pos.y + HEADER_H + shown * ROW_H + 11.5}
                        fontSize={10.5}
                        className="fill-primary cursor-pointer"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          toggleExpand(n.table);
                        }}
                      >
                        {isExpanded ? t("collapse") : t("moreColumns", { count: cols.length - shown })}
                      </text>
                    )}

                    {/* Link handle — hover reveal, drag to a target card */}
                    <g
                      className="opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair"
                      onMouseDown={(e) => startLink(e, n)}
                    >
                      <circle
                        cx={n.pos.x + CARD_WIDTH - 13}
                        cy={n.pos.y + HEADER_H / 2}
                        r={8}
                        className="fill-background stroke-primary"
                        strokeWidth={1.5}
                      />
                      <path
                        d={`M ${n.pos.x + CARD_WIDTH - 17} ${n.pos.y + HEADER_H / 2} h 8 M ${n.pos.x + CARD_WIDTH - 13} ${n.pos.y + HEADER_H / 2 - 4} v 8`}
                        className="stroke-primary"
                        strokeWidth={1.5}
                      />
                      <title>{t("dragHint")}</title>
                    </g>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {/* Legend */}
        {!loading && !error && map && map.tables.length > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-4 px-3 py-1.5 text-[11px] text-muted-foreground bg-card/90 border border-border rounded-lg shadow">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 border-t-2 border-primary" />
              {t("legendDeclared")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 border-t-2 border-dashed border-muted-foreground" />
              {t("legendHeuristic")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border border-dashed border-muted-foreground rounded-sm" />
              {t("legendIsolated")}
            </span>
          </div>
        )}
      </div>

      {/* Edge popover */}
      {popover && (
        <div
          className="fixed z-[70] w-72 bg-card border border-border rounded-lg shadow-xl animate-menu-in p-3 space-y-2"
          style={{
            left: Math.min(popover.x + 10, window.innerWidth - 300),
            top: Math.min(popover.y + 10, window.innerHeight - 240),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="font-mono text-[11px] text-foreground break-all leading-relaxed">
              {popover.edge.childTable}.{popover.edge.childColumn}
              <span className="text-muted-foreground"> → </span>
              {popover.edge.parentTable}.{popover.edge.parentColumn}
            </div>
            <button
              onClick={() => setPopover(null)}
              className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{sourceLabel(popover.edge.source)}</span>
            {popover.edge.source === "inferred" && <span>· ?</span>}
          </div>
          <div className="min-h-[20px] flex items-center gap-2">
            <button
              onClick={() => void runProbe()}
              disabled={probe.state === "loading"}
              className="px-2 py-0.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              {t("probe")}
            </button>
            {probeBadge}
          </div>
          {popover.edge.source !== "declared" && (
            <div className="flex items-center gap-2">
              {popover.edge.source === "inferred" && (
                <button
                  onClick={() => void adjudicate(true)}
                  className="px-2 py-0.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  {t("confirmLink")}
                </button>
              )}
              <button
                onClick={() => void adjudicate(false)}
                className="px-2 py-0.5 text-xs font-medium rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                {popover.edge.source === "inferred" ? t("vetoLink") : t("removeLink")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* New-link modal, prefilled from the drag gesture */}
      <RelationshipModal
        open={!!relModal}
        connectionId={connectionId}
        database={database ?? undefined}
        childTable={relModal?.childTable}
        suggestedParent={relModal?.parentTable}
        onChanged={() => void load()}
        onClose={() => setRelModal(null)}
      />
    </div>
  );
}
