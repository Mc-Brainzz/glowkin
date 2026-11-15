// Caps how often we draw, whatever the display's refresh rate. A 144Hz screen
// would otherwise make an idle creature draw 144 times a second.
//
// const due = createPacer();
// function frame(now) { requestAnimationFrame(frame); if (!due(now, 30)) return; draw(); }
export function createPacer() {
  let last = null;
  return function due(now, fps) {
    const interval = 1000 / fps;
    if (last !== null && now - last < interval - 2) return false;
    // Keep the long-run average on target, but never try to catch up after a pause.
    last = last === null || now - last > interval * 2 ? now : last + interval;
    return true;
  };
}
