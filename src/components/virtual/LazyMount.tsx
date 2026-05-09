interface LazyMountProps {
  visible: boolean;
  keepAlive?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function LazyMount({
  visible,
  keepAlive,
  fallback,
  children,
}: LazyMountProps) {
  const [hasMounted, setHasMounted] = React.useState(visible);

  React.useEffect(() => {
    if (visible) setHasMounted(true);
  }, [visible]);

  if (!visible && !hasMounted) return <>{fallback}</>;
  if (!visible && keepAlive) return <div className="hidden">{children}</div>;
  if (!visible) return null;

  return <>{children}</>;
}

import React from "react";
