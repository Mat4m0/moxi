export function createImage(size: number, memory: () => Uint8Array) {
  let nextHandle = 1;
  const handles = new Set<number>();
  // Sorted, non-overlapping [start, end) ranges this session has fetched. The
  // client's startup waits until isCached reports its prefetched ranges.
  let fetched: [number, number][] = [];
  function remember(start: number, end: number) {
    const kept: [number, number][] = [];
    for (const [a, b] of fetched) {
      if (b < start || a > end) kept.push([a, b]);
      else [start, end] = [Math.min(a, start), Math.max(b, end)];
    }
    kept.push([start, end]);
    fetched = kept.sort((x, y) => x[0] - y[0]);
  }
  async function read(
    handle: number,
    offset: number,
    length: number,
    receive: (bytes: Uint8Array, position: number) => void,
  ) {
    if (
      !handles.has(handle) ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > size - length
    )
      throw new Error("The game requested an invalid image range.");
    for (let position = 0; position < length;) {
      const take = Math.min(length - position, 8 * 1024 * 1024);
      const response = await fetch("moxi://app/client/Gw.snapshot", {
        headers: { Range: `bytes=${offset + position}-${offset + position + take - 1}` },
      });
      if (response.status !== 206) throw new Error("The game image could not be read.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== take) throw new Error("The game image read was incomplete.");
      receive(bytes, position);
      remember(offset + position, offset + position + take);
      position += take;
    }
  }
  return {
    open(path: string) {
      if (!/(^|[/\\])Gw\.snapshot$/i.test(path)) return 0;
      const handle = nextHandle++;
      handles.add(handle);
      return handle;
    },
    close(handle: number) {
      handles.delete(handle);
    },
    fileSize: (handle: number) => (handles.has(handle) ? size : 0),
    readAsync(handle: number, offset: number, _unused: unknown, buffer: number, length: number) {
      // JSPI can grow memory while a read waits; acquire the view after each response.
      return read(handle, offset, length, (bytes, position) =>
        memory().set(bytes, buffer + position),
      );
    },
    isCached: (_handle: number, offset: number, length: number) =>
      fetched.some(([start, end]) => start <= offset && offset + length <= end) ? 1 : 0,
    cacheAsync(handle: number, offset: number, length: number, progress: (bytes: number) => void) {
      return read(handle, offset, length, (bytes) => progress(bytes.length));
    },
  };
}
