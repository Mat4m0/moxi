import type { Bridge, SocketEvent } from "@moxi/contracts";

type GameSocket = {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((bytes: Uint8Array) => void) | null;
  send(bytes: Uint8Array | ArrayBuffer): Promise<void>;
  close(): void;
};

export function createSocketHost(
  bridge: Bridge<"game">,
  onSafePoint: (callback: () => void) => () => void,
  opened: () => void,
) {
  const sockets = new Map<number, { socket: GameSocket; open: boolean; closing: boolean }>();
  let events: SocketEvent[] = [];
  let nextId = 0;
  let disposed = false;
  const unsubscribe = bridge.onSocketEvent((event) => {
    if (sockets.has(event.id)) events.push(event);
  });
  const stop = onSafePoint(() => {
    const pending = events;
    events = [];
    for (const event of pending) {
      const entry = sockets.get(event.id);
      if (!entry) continue;
      if (event.kind === "close") {
        sockets.delete(event.id);
        entry.socket.onclose?.();
      } else if (event.kind === "open") {
        if (entry.closing) continue;
        entry.open = true;
        opened();
        entry.socket.onopen?.();
      } else if (event.kind === "data") {
        try {
          if (!entry.closing) entry.socket.onmessage?.(event.bytes);
        } finally {
          void bridge
            .invoke("game.net.ack", { id: event.id, bytes: event.bytes.length })
            .catch(() => entry.socket.close());
        }
      }
    }
  });
  return {
    socket: {
      connect(destination: string): GameSocket {
        const id = nextId++;
        const entry: { socket: GameSocket; open: boolean; closing: boolean } = {
          socket: {
            onopen: null,
            onclose: null,
            onmessage: null,
            async send(data: Uint8Array | ArrayBuffer) {
              if (!entry.open || entry.closing) throw new Error("Game connection is not open.");
              const bytes = Uint8Array.from(
                data instanceof Uint8Array ? data : new Uint8Array(data),
              );
              try {
                await bridge.invoke("game.net.write", { id, bytes });
              } catch (error) {
                entry.socket.close();
                throw error;
              }
            },
            close() {
              if (entry.closing) return;
              entry.closing = true;
              void bridge.invoke("game.net.close", { id }).catch(() => {
                events.push({ id, kind: "close" });
              });
            },
          } satisfies GameSocket,
          open: false,
          closing: false,
        };
        if (disposed) throw new Error("Game network has stopped.");
        sockets.set(id, entry);
        void bridge.invoke("game.net.connect", { id, destination }).catch(() => {
          events.push({ id, kind: "close" });
        });
        return entry.socket;
      },
    },
    dispose() {
      disposed = true;
      unsubscribe();
      stop();
      for (const entry of sockets.values()) entry.socket.close();
      sockets.clear();
      events = [];
    },
  };
}
