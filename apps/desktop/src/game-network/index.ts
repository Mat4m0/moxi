import { Socket } from "node:net";
import { promises as dns } from "node:dns";
import type { SocketEvent } from "@moxi/contracts";

export const BUFFER_LIMIT = 1024 * 1024;
export function allowedName(name: string) {
  return /^(?:[a-z0-9-]+\.)*(arenanetworks\.com|guildwars\.com)\.?$/i.test(name);
}
export function allowedDestination(host: string, port: number) {
  if (![6112, 80, 443].includes(port)) return false;
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(host)) return false;
  const parts = host.split(".").map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  return (
    !parts.some((n) => n > 255) &&
    !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
  );
}

export function createGameNetwork(
  emit: (owner: number, event: SocketEvent) => void,
  allow = allowedDestination,
) {
  const owners = new Map<
    number,
    Map<
      number,
      {
        socket: Socket;
        incoming: number;
        outgoing: number;
        reason: string;
        received: number;
        sent: number;
      }
    >
  >();
  const connected = new Set<number>();
  const closed = new Map<number, Set<number>>();
  function owned(owner: number, id: number) {
    const entry = owners.get(owner)?.get(id);
    if (!entry) throw new Error("This window does not own that socket.");
    return entry;
  }
  return {
    connect(owner: number, id: number, destination: string) {
      const match = /^([^:]+):(\d+)$/.exec(destination);
      const host = match?.[1] ?? "";
      const port = Number(match?.[2]);
      if (!allow(host, port)) throw new Error("Game server address refused.");
      const sockets = owners.get(owner) ?? new Map();
      if (sockets.has(id) || sockets.size >= 32) throw new Error("Too many game connections.");
      owners.set(owner, sockets);
      const socket = new Socket();
      const entry = { socket, incoming: 0, outgoing: 0, reason: "remote", received: 0, sent: 0 };
      closed.get(owner)?.delete(id);
      sockets.set(id, entry);
      console.info(`[net] connect ${host}:${port}`);
      socket.on("connect", () => {
        console.info(`[net] open ${host}:${port}`);
        socket.setTimeout(0);
        connected.add(owner);
        emit(owner, { id, kind: "open" });
      });
      socket.on("data", (bytes) => {
        entry.incoming += bytes.length;
        entry.received += bytes.length;
        if (entry.incoming > BUFFER_LIMIT) {
          entry.reason = "buffer limit";
          socket.destroy();
          return;
        }
        socket.pause();
        emit(owner, { id, kind: "data", bytes: Uint8Array.from(bytes) });
      });
      socket.on("error", () => {
        entry.reason = "error";
      });
      socket.on("timeout", () => {
        entry.reason = "timeout";
        socket.destroy();
      });
      socket.on("close", () => {
        if (owners.get(owner) === sockets) {
          const ids = closed.get(owner) ?? new Set<number>();
          ids.add(id);
          closed.set(owner, ids);
        }
        sockets.delete(id);
        if (!sockets.size && owners.get(owner) === sockets) owners.delete(owner);
        console.info(
          `[net] close ${host}:${port} ${entry.reason} in=${entry.received} out=${entry.sent}`,
        );
        emit(owner, { id, kind: "close" });
      });
      socket.setTimeout(30000);
      socket.setNoDelay(true);
      socket.connect(port, host);
      return undefined;
    },
    write(owner: number, id: number, bytes: Uint8Array) {
      const entry = owned(owner, id);
      if (entry.socket.connecting || entry.socket.destroyed)
        throw new Error("Game connection is not open.");
      if (entry.outgoing + bytes.byteLength > BUFFER_LIMIT) {
        entry.reason = "buffer limit";
        entry.socket.destroy();
        throw new Error("Game connection buffer limit exceeded.");
      }
      entry.outgoing += bytes.byteLength;
      entry.sent += bytes.byteLength;
      entry.socket.write(bytes, () => {
        entry.outgoing -= bytes.byteLength;
      });
      return undefined;
    },
    ack(owner: number, id: number, bytes: number) {
      if (closed.get(owner)?.has(id)) return undefined;
      const entry = owned(owner, id);
      if (bytes !== entry.incoming) throw new Error("Invalid game buffer acknowledgement.");
      entry.incoming = 0;
      entry.socket.resume();
      return undefined;
    },
    close(owner: number, id: number) {
      const entry = owned(owner, id);
      entry.reason = "client";
      entry.socket.destroy();
      return undefined;
    },
    closeWindow(owner: number) {
      for (const entry of owners.get(owner)?.values() ?? []) {
        entry.reason = "window closed";
        entry.socket.destroy();
      }
      owners.delete(owner);
      connected.delete(owner);
      closed.delete(owner);
    },
    hasConnected: (owner: number) => connected.has(owner),
    async resolve(name: string) {
      if (!allowedName(name)) throw new Error("Game server name refused.");
      const answers = await dns.resolve4(name);
      const address = answers[0];
      if (!address) throw new Error("Game server name could not be resolved.");
      return address;
    },
  };
}
