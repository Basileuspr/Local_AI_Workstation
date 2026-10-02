import { createContext } from "react";

export const FloatingToolBoundsContext = createContext(null);

// Native Electron views draw above HTML. Leave the largest unobstructed area
// for the page instead of hiding the entire page while the timer is visible.
export function avoidFloatingTool(bounds, overlay) {
  if (!bounds || !overlay) return bounds;
  const left = Math.max(bounds.x, overlay.x - 8), top = Math.max(bounds.y, overlay.y - 8);
  const right = Math.min(bounds.x + bounds.width, overlay.x + overlay.width + 8);
  const bottom = Math.min(bounds.y + bounds.height, overlay.y + overlay.height + 8);
  if (left >= right || top >= bottom) return bounds;
  return [
    { ...bounds, width: left - bounds.x },
    { ...bounds, x: right, width: bounds.x + bounds.width - right },
    { ...bounds, height: top - bounds.y },
    { ...bounds, y: bottom, height: bounds.y + bounds.height - bottom },
  ].sort((a, b) => b.width * b.height - a.width * a.height)[0];
}
