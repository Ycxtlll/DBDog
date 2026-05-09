import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";

export interface TreeNode<T> {
  id: string;
  data: T;
  children?: TreeNode<T>[];
}

interface FlatNode<T> {
  id: string;
  data: T;
  depth: number;
  hasChildren: boolean;
}

interface VirtualTreeProps<T> {
  roots: TreeNode<T>[];
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  renderNode: (node: T, depth: number, isExpanded: boolean) => React.ReactNode;
  rowHeight?: number;
}

export function VirtualTree<T>({
  roots,
  expandedKeys,
  onToggle,
  renderNode,
  rowHeight = 28,
}: VirtualTreeProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const flatNodes = useMemo<FlatNode<T>[]>(() => {
    const result: FlatNode<T>[] = [];
    function walk(nodes: TreeNode<T>[], depth: number) {
      for (const node of nodes) {
        const hasChildren = !!node.children && node.children.length > 0;
        result.push({ id: node.id, data: node.data, depth, hasChildren });
        if (hasChildren && expandedKeys.has(node.id)) {
          walk(node.children!, depth + 1);
        }
      }
    }
    walk(roots, 0);
    return result;
  }, [roots, expandedKeys]);

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const node = flatNodes[virtualItem.index];
          const isExpanded = expandedKeys.has(node.id);
          return (
            <div
              key={virtualItem.key}
              className="flex items-center cursor-pointer hover:bg-accent/50 group"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
                paddingLeft: `${node.depth * 16 + 8}px`,
              }}
              onClick={() => {
                if (node.hasChildren) onToggle(node.id);
              }}
            >
              {node.hasChildren && (
                <span className="mr-1 text-xs select-none">
                  {isExpanded ? "▼" : "▶"}
                </span>
              )}
              {renderNode(node.data, node.depth, isExpanded)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
