import type { Bridge, SocketEvent } from "@moxi/contracts";

type GameSocket = {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((bytes: Uint8Array) => void) | null;
  send(bytes: Uint8Array | ArrayBuffer): Promise<void>;
  close(): void;
};

// Events are delivered as they arrive, like WebSocket events: the client may
// wait for network data inside a frame, so gating them on frame ends deadlocks.
export function createSocketHost(bridge: Bridge<"game">, opened: () => void) {
  const sockets = new Map<number, { socket: GameSocket; open: boolean; closing: boolean }>();
  let nextId = 0;
  let disposed = false;
  function deliver(event: SocketEvent) {
    const entry = sockets.get(event.id);
    if (!entry) return;
    if (event.kind === "close") {
      sockets.delete(event.id);
      entry.socket.onclose?.();
    } else if (event.kind === "open") {
      if (entry.closing) return;
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
  const unsubscribe = bridge.onSocketEvent(deliver);
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
                deliver({ id, kind: "close" });
              });
            },
          } satisfies GameSocket,
          open: false,
          closing: false,
        };
        if (disposed) throw new Error("Game network has stopped.");
        sockets.set(id, entry);
        void bridge.invoke("game.net.connect", { id, destination }).catch(() => {
          deliver({ id, kind: "close" });
        });
        return entry.socket;
      },
    },
    dispose() {
      disposed = true;
      unsubscribe();
      for (const entry of sockets.values()) entry.socket.close();
      sockets.clear();
    },
  };
}
