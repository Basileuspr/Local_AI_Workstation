import { Suspense, useEffect, useState } from 'react';

// The first visit starts the workspace. Subsequent tab changes only hide it:
// drafts, selections, native surfaces and running work retain their owners.
export default function DeferredWorkspace({ active, children }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!active && !visited) return null;
  return <Suspense fallback={<p role="status">Opening workspace…</p>}>{children}</Suspense>;
}
