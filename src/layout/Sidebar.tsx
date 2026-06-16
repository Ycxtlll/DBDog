import { useLayoutStore } from "../stores/layoutStore";
import { ConnectionPanel } from "../components/sidebar/ConnectionPanel";
import { SchemaTreePanel } from "../components/sidebar/SchemaTreePanel";
import { MemcachedPanel } from "../components/memcached/MemcachedPanel";

export function Sidebar() {
  const { sidebarVisible, sidebarWidth } = useLayoutStore();

  if (!sidebarVisible) return null;

  return (
    <div
      className="flex flex-col border-r border-border bg-card"
      style={{ width: sidebarWidth, minWidth: 200, maxWidth: 500 }}
    >
      <div className="flex-1 overflow-hidden">
        <SidebarContent />
      </div>
    </div>
  );
}

function SidebarContent() {
  const { sidebarView } = useLayoutStore();

  if (sidebarView === "schema") {
    return <SchemaTreePanel />;
  }
  if (sidebarView === "memcached") {
    return <MemcachedPanel />;
  }
  return <ConnectionPanel />;
}
