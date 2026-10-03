export const PAINT_SHAPES = [
  ['line', 'Line'], ['curve', 'Curve'], ['ellipse', 'Oval'], ['rect', 'Rectangle'], ['roundRect', 'Rounded rectangle'],
  ['polygon', 'Polygon'], ['triangle', 'Triangle'], ['rightTriangle', 'Right triangle'], ['diamond', 'Diamond'],
  ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['arrow', 'Right arrow'], ['leftArrow', 'Left arrow'],
  ['upArrow', 'Up arrow'], ['downArrow', 'Down arrow'], ['star4', 'Four-point star'], ['star5', 'Five-point star'],
  ['star6', 'Six-point star'], ['callout', 'Rectangular callout'], ['ovalCallout', 'Oval callout'], ['cloud', 'Cloud callout'],
  ['heart', 'Heart'], ['lightning', 'Lightning'],
];
export const PAINT_BRUSHES = [
  ['brush', 'Brush'], ['calligraphy', 'Calligraphy brush'], ['calligraphyPen', 'Calligraphy pen'], ['airbrush', 'Airbrush'],
  ['oil', 'Oil brush'], ['crayon', 'Crayon'], ['marker', 'Marker'], ['naturalPencil', 'Natural pencil'], ['watercolor', 'Watercolor brush'],
];
function vertices(ctx, points) {
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
}
function regular(ctx, sides, inner = null) {
  const count = inner ? sides * 2 : sides;
  vertices(ctx, Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / count, radius = inner && i % 2 ? inner : .5;
    return [.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius];
  }));
}
export function tracePaintShape(ctx, type, a, b, control = null, polygon = null) {
  ctx.beginPath();
  if (type === 'line' || type === 'curve') {
    ctx.moveTo(a.x, a.y);
    if (type === 'curve') ctx.quadraticCurveTo(control?.x ?? (a.x + b.x) / 2, control?.y ?? Math.min(a.y, b.y) - Math.abs(b.x - a.x) / 3, b.x, b.y);
    else ctx.lineTo(b.x, b.y);
    return;
  }
  if (polygon) { vertices(ctx, polygon.map(p => [p.x, p.y])); return; }
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.max(1, Math.abs(b.x - a.x)), h = Math.max(1, Math.abs(b.y - a.y));
  ctx.save(); ctx.translate(x, y); ctx.scale(w, h);
  if (type === 'rect') ctx.rect(0, 0, 1, 1);
  else if (type === 'roundRect') ctx.roundRect(0, 0, 1, 1, .12);
  else if (type === 'ellipse') ctx.ellipse(.5, .5, .5, .5, 0, 0, Math.PI * 2);
  else if (type === 'triangle') vertices(ctx, [[.5, 0], [1, 1], [0, 1]]);
  else if (type === 'rightTriangle') vertices(ctx, [[0, 0], [1, 1], [0, 1]]);
  else if (type === 'diamond') regular(ctx, 4);
  else if (type === 'pentagon') regular(ctx, 5);
  else if (type === 'hexagon') regular(ctx, 6);
  else if (type.startsWith('star')) regular(ctx, Number(type.slice(4)), .2);
  else if (['arrow', 'leftArrow', 'upArrow', 'downArrow'].includes(type)) {
    if (type === 'leftArrow') { ctx.translate(1, 1); ctx.rotate(Math.PI); }
    if (type === 'upArrow') { ctx.translate(0, 1); ctx.rotate(-Math.PI / 2); }
    if (type === 'downArrow') { ctx.translate(1, 0); ctx.rotate(Math.PI / 2); }
    vertices(ctx, [[0, .3], [.6, .3], [.6, 0], [1, .5], [.6, 1], [.6, .7], [0, .7]]);
  } else if (type === 'callout') vertices(ctx, [[0, 0], [1, 0], [1, .75], [.45, .75], [.2, 1], [.25, .75], [0, .75]]);
  else if (type === 'ovalCallout') {
    ctx.moveTo(.3, .72); ctx.bezierCurveTo(-.3, .65, 0, 0, .5, 0); ctx.bezierCurveTo(1.3, 0, 1.2, .8, .5, .75);
    ctx.lineTo(.2, 1); ctx.closePath();
  } else if (type === 'cloud') {
    ctx.moveTo(.2, .75); ctx.bezierCurveTo(-.15, .7, -.1, .35, .1, .35); ctx.bezierCurveTo(0, .05, .35, -.1, .5, .12);
    ctx.bezierCurveTo(.65, -.1, 1, .05, .9, .35); ctx.bezierCurveTo(1.2, .35, 1.15, .75, .8, .75);
    ctx.bezierCurveTo(.7, .9, .4, .85, .4, .75); ctx.lineTo(.12, 1); ctx.closePath();
  } else if (type === 'heart') {
    ctx.moveTo(.5, 1); ctx.bezierCurveTo(-.4, .4, .1, -.35, .5, .2); ctx.bezierCurveTo(.9, -.35, 1.4, .4, .5, 1); ctx.closePath();
  } else if (type === 'lightning') vertices(ctx, [[.35, 0], [.9, 0], [.55, .4], [.85, .4], [.1, 1], [.35, .55], [0, .55]]);
  else vertices(ctx, [[0, 1], [.2, .15], [.6, 0], [1, .6], [.75, 1]]);
  ctx.restore();
}

export function drawPaintShape(ctx, type, a, b, settings, control = null, polygon = null) {
  ctx.save(); ctx.lineWidth = settings.size; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.globalAlpha = settings.opacity / 100;
  tracePaintShape(ctx, type, a, b, control, polygon);
  if (!['line', 'curve'].includes(type) && settings.fill !== 'none') { ctx.fillStyle = settings.fill === 'secondary' ? settings.secondary : settings.primary; ctx.fill(); }
  if (settings.outline !== 'none' || ['line', 'curve'].includes(type)) { ctx.strokeStyle = settings.primary; ctx.stroke(); }
  ctx.restore();
}

export function drawPaintStroke(ctx, points, settings) {
  if (!points.length) return;
  const brush = settings.tool === 'pencil' ? 'pencil' : settings.brush, size = settings.tool === 'pencil' ? 1 : settings.size;
  ctx.save(); ctx.fillStyle = settings.primary; ctx.strokeStyle = settings.primary; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha = settings.opacity / 100 * (brush === 'watercolor' ? .3 : brush === 'marker' ? .65 : 1);
  if (['calligraphy', 'calligraphyPen', 'airbrush', 'crayon', 'naturalPencil'].includes(brush)) {
    let previous = points[0];
    for (const point of points) {
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y), count = Math.max(1, Math.ceil(distance / Math.max(1, size / 5)));
      for (let step = 1; step <= count; step++) {
        const x = previous.x + (point.x - previous.x) * step / count, y = previous.y + (point.y - previous.y) * step / count;
        const diameter = Math.max(1, size * (settings.pressure ? Math.max(.15, point.pressure || .5) : 1));
        if (brush === 'calligraphy' || brush === 'calligraphyPen') {
          ctx.beginPath(); ctx.ellipse(x, y, diameter / 2, Math.max(.5, diameter / (brush === 'calligraphyPen' ? 8 : 4)), -Math.PI / 4, 0, Math.PI * 2); ctx.fill();
        } else {
          const dots = brush === 'airbrush' ? 12 : 8;
          for (let dot = 0; dot < dots; dot++) {
            const seed = Math.sin(x * 12.98 + y * 78.23 + dot * 19.19) * 43758.54, frac = seed - Math.floor(seed);
            const radius = Math.sqrt(frac) * diameter / 2, angle = frac * 101 + dot * 2.4;
            ctx.fillRect(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, brush === 'crayon' ? 1.5 : 1, brush === 'crayon' ? 1.5 : 1);
          }
        }
      }
      previous = point;
    }
  } else {
    ctx.lineWidth = size; if (brush === 'marker') ctx.lineCap = 'square';
    if (points.length === 1) { ctx.beginPath(); ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    if (brush === 'oil') { ctx.globalAlpha *= .2; ctx.lineWidth = Math.max(1, size / 6); ctx.stroke(); }
  }
  ctx.restore();
}
