export interface ReleasedRendererResources {
  canvasCount: number;
  backingPixels: number;
}

export interface RendererPoolDrainResult extends ReleasedRendererResources {
  disposedRendererCount: number;
}

export function drainRendererPool<T>(
  pool: T[],
  dispose: (renderer: T) => ReleasedRendererResources,
): RendererPoolDrainResult {
  const renderers = pool.splice(0);
  let canvasCount = 0;
  let backingPixels = 0;
  for (const renderer of renderers) {
    const released = dispose(renderer);
    canvasCount += released.canvasCount;
    backingPixels += released.backingPixels;
  }
  return {
    disposedRendererCount: renderers.length,
    canvasCount,
    backingPixels,
  };
}

export function remainingLiveTerminalCount(
  terminalIds: readonly number[],
  closingOrReleasedIds: ReadonlySet<number>,
  currentId: number,
): number {
  return terminalIds.filter((id) => (
    id !== currentId && !closingOrReleasedIds.has(id)
  )).length;
}
