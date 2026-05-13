import React from "react";

interface LazyMountProps {
  visible: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function LazyMount({
  visible,
  fallback,
  children,
}: LazyMountProps) {
  const [hasMounted, setHasMounted] = React.useState(visible);

  React.useEffect(() => {
    if (visible) setHasMounted(true);
  }, [visible]);

  if (!visible && !hasMounted) return <>{fallback}</>;
  if (!visible) return null;

  return <>{children}</>;
}
