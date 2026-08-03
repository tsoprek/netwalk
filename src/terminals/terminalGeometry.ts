// Thresholds guard against fitting the terminal to a transient 0×0 or 1×1
// measurement during a mosaic drag or an early mount frame. They also cap the
// smallest usable PTY grid; 8×3 is roughly the smallest grid where a shell
// prompt is still legible in a 6-way vertical split.
const MIN_FIT_WIDTH = 80;
const MIN_FIT_HEIGHT = 40;
const MIN_PTY_COLS = 8;
const MIN_PTY_ROWS = 3;

export type TerminalGrid = { cols: number; rows: number };

export function isUsableTerminalGeometry(width: number, height: number): boolean {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width >= MIN_FIT_WIDTH
    && height >= MIN_FIT_HEIGHT;
}

export function isUsableTerminalGrid(cols: number, rows: number): boolean {
  return Number.isFinite(cols)
    && Number.isFinite(rows)
    && cols >= MIN_PTY_COLS
    && rows >= MIN_PTY_ROWS;
}

export function initialTerminalGrid(
  viewportWidth: number,
  viewportHeight: number,
  fontSize: number,
): TerminalGrid {
  const cellWidth = Math.max(5, fontSize * 0.62);
  const cellHeight = Math.max(10, fontSize * 1.2);
  const availableWidth = Math.max(0, viewportWidth - 280);
  const availableHeight = Math.max(0, viewportHeight - 180);
  return {
    cols: Math.max(80, Math.min(240, Math.floor(availableWidth / cellWidth))),
    rows: Math.max(24, Math.min(100, Math.floor(availableHeight / cellHeight))),
  };
}
