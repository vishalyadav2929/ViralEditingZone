// Camera moves: the feel of a moving camera (dolly, pan, crane, punch zoom, gentle drift) made from
// an animated crop window over the frame — no AI, no extra rendering pass. Pure maths (tested in
// Node): app.js's drawVideo applies the same window in the preview and in every export path, so
// what you see while editing is exactly what lands in the file.

export const CAMERA_MOVES = [
  { id: 'none', name: 'Off' },
  { id: 'dolly-in', name: 'Dolly in · slow zoom in' },
  { id: 'dolly-out', name: 'Dolly out · slow zoom out' },
  { id: 'pan-left', name: 'Pan left' },
  { id: 'pan-right', name: 'Pan right' },
  { id: 'crane-up', name: 'Crane up' },
  { id: 'crane-down', name: 'Crane down' },
  { id: 'punch', name: 'Punch zoom · hook' },
  { id: 'drift', name: 'Drift · subtle parallax' },
];

const clamp01 = v => Math.min(1, Math.max(0, v));
const easeInOut = p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOut = p => 1 - Math.pow(1 - p, 3);

/**
 * The crop window at progress p (0..1 across the video, or across the short being edited):
 * { s, cx, cy } — s is the zoom (≥ 1) and cx/cy the window's centre as fractions of the frame.
 * amt (0..1) scales how strong the move is. Returns null for 'none'/unknown moves.
 */
export function camWindow(move, p, amt = 1) {
  p = clamp01(p);
  const a = clamp01(amt == null ? 1 : amt);
  const zoom = z => 1 + (z - 1) * a;
  const travel = () => 0.07 * a * (1 - 2 * easeInOut(p)); // +0.07 → −0.07 across the clip
  switch (move) {
    case 'dolly-in': return { s: zoom(1 + 0.28 * easeInOut(p)), cx: 0.5, cy: 0.5 };
    case 'dolly-out': return { s: zoom(1.28 - 0.28 * easeInOut(p)), cx: 0.5, cy: 0.5 };
    case 'pan-left': return { s: zoom(1.18), cx: 0.5 + travel(), cy: 0.5 };
    case 'pan-right': return { s: zoom(1.18), cx: 0.5 - travel(), cy: 0.5 };
    case 'crane-up': return { s: zoom(1.18), cx: 0.5, cy: 0.5 + 0.07 * a * (1 - 2 * easeInOut(p)) };
    case 'crane-down': return { s: zoom(1.18), cx: 0.5, cy: 0.5 - 0.07 * a * (1 - 2 * easeInOut(p)) };
    case 'punch': {
      // A fast punch in the first moments (the hook), then a slow push for the rest.
      const s = p < 0.16 ? 1 + 0.34 * easeOut(p / 0.16) : 1.34 + 0.08 * easeInOut((p - 0.16) / 0.84);
      return { s: zoom(s), cx: 0.5, cy: 0.46 };
    }
    case 'drift': {
      // A slow, gentle wander — the single-layer cousin of parallax.
      return { s: zoom(1.12), cx: 0.5 + 0.028 * a * Math.sin(p * Math.PI * 1.4), cy: 0.5 + 0.02 * a * Math.sin(p * Math.PI * 1.1 + 1.3) };
    }
    default: return null;
  }
}

/** Apply a window to a source rect { sx, sy, sw, sh }: the sub-rect to draw, kept inside the rect. */
export function camRect(rect, win) {
  if (!win) return rect;
  const sw = rect.sw / win.s, sh = rect.sh / win.s;
  const cx = Math.min(Math.max(rect.sx + win.cx * rect.sw, rect.sx + sw / 2), rect.sx + rect.sw - sw / 2);
  const cy = Math.min(Math.max(rect.sy + win.cy * rect.sh, rect.sy + sh / 2), rect.sy + rect.sh - sh / 2);
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}
