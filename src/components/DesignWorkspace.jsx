import { useEffect, useState } from 'react';
import { DESIGN_TAB } from '../designWorkspace';
import { loadNavigationOrder, orderedSections, NAVIGATION_ORDER_KEY } from '../navigationOrder';
import './DesignWorkspace.css';

export default function DesignWorkspace({ tab, onNavigate, children }) {
  const [order, setOrder] = useState(loadNavigationOrder);
  useEffect(() => {
    const refresh = event => { if (!event.key || event.key === NAVIGATION_ORDER_KEY) setOrder(loadNavigationOrder()); };
    window.addEventListener('storage', refresh); window.addEventListener('navigation-order-changed', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('navigation-order-changed', refresh); };
  }, []);
  const tabs = [{ id: DESIGN_TAB, label: 'UI Playground' }, ...orderedSections(order).find(section => section.id === 'design-code').items];
  function navigate(target) {
    onNavigate(target);
    requestAnimationFrame(() => document.querySelector(`[data-capture-tab="${target}"]:not([hidden]) [data-design-route="${target}"]`)?.focus());
  }
  return <section className="design-workspace" aria-label="Design & Programming">
    <header className="design-heading"><div><span className="design-eyebrow">CREATE · EXPERIMENT · INSPECT</span><h1>Design &amp; Programming</h1></div><span className="design-local">Local workspace</span></header>
    <nav className="design-tabs" aria-label="Design & Programming tools">
      {tabs.map(item => <button key={item.id} type="button" data-design-route={item.id} aria-current={tab === item.id ? 'page' : undefined}
        onClick={() => navigate(item.id)}>{item.label}</button>)}
    </nav>
    <div className="design-content">{children}</div>
  </section>;
}
