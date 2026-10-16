// Pure reconciliation of the graph's drawable size and pan after a viewport
// or panel resize (VAL-UI-008). The old ResizeObserver clamped every canvas
// to at least 400x300, so a 390px-wide panel rendered a 400px graph whose
// right edge (minimap, zoom indicator, nodes) was clipped and not clickable.
// It also left a deliberate pan/zoom untouched while the layout reflowed,
// which read as "the graph recenters badly until Reset View is pressed".
//
// Rules implemented here:
// - The graph always uses the actual drawable size (floored at 1px so the
//   simulation never divides by zero or a negative size).
// - A deliberate pan/zoom survives resize: the pan shifts by half the size
//   delta so the content point under the old viewport center stays at the
//   new center (pan' = pan + delta/2 holds at any zoom), and the zoom value
//   itself is never changed. No blind reset to identity.
// - The default view (zoom 1, pan at origin) keeps the origin so the layout
//   effects can re-frame the graph into the new size on their own.

export interface GraphViewportSize {
  width: number;
  height: number;
}

export interface GraphViewportPan {
  x: number;
  y: number;
}

export interface GraphViewTransform {
  zoom: number;
  pan: GraphViewportPan;
}

export interface ReconciledGraphView {
  width: number;
  height: number;
  pan: GraphViewportPan;
  changed: boolean;
}

export function reconcileGraphView(
  prev: GraphViewportSize,
  next: GraphViewportSize,
  transform: GraphViewTransform,
): ReconciledGraphView {
  const width = Math.max(1, Math.round(next.width));
  const height = Math.max(1, Math.round(next.height));

  if (width === prev.width && height === prev.height) {
    return { width, height, pan: transform.pan, changed: false };
  }

  const deliberate =
    transform.zoom !== 1 || transform.pan.x !== 0 || transform.pan.y !== 0;

  if (!deliberate) {
    return { width, height, pan: transform.pan, changed: true };
  }

  const pan = {
    x: transform.pan.x + (width - prev.width) / 2,
    y: transform.pan.y + (height - prev.height) / 2,
  };
  return { width, height, pan, changed: true };
}
