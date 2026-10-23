import {useLayoutEffect, useRef} from 'react';
import './ScrollToolbar.css';
import {observeScrollToolbar} from '../scrollToolbar';

// Observe the scroll pane, not the desktop viewport: pinned panes and inline
// editors can be much shorter than the window. Controls keep their DOM identity.
export default function ScrollToolbar({as: Tag = 'div', label = 'Workspace controls', className = '', children, ...props}) {
  const ref = useRef(null);
  useLayoutEffect(() => observeScrollToolbar(ref.current), []);
  return <Tag ref={ref} className={`scroll-toolbar ${className}`} role="region" aria-label={label} tabIndex={0} {...props}>{children}</Tag>;
}
