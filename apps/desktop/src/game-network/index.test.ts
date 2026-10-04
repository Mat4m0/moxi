import { createServer, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { afterEach, expect, test } from "vite-plus/test";
import type { SocketEvent } from "@moxi/contracts";
import { allowedDestination, allowedName, BUFFER_LIMIT, createGameNetwork } from "./index";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function echoServer() {
  const peers = new Set<Socket>();
  const server: Server = createServer((socket) => {
    peers.add(socket);
    socket.on("close", () => peers.delete(socket));
    socket.pipe(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Echo server has no port");
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        for (const peer of peers) peer.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `127.0.0.1:${address.port}`;
}

// These cases catch private-network access and suffix lookalikes reaching Main's network.
test.each([
  ["8.8.8.8", 6112, true],
  ["8.8.8.8", 80, true],
  ["8.8.8.8", 443, true],
  ["8.8.8.8", 22, false],
  ["127.0.0.1", 6112, false],
  ["10.0.0.1", 6112, false],
  ["172.16.0.1", 6112, false],
  ["192.168.0.1", 6112, false],
  ["100.64.0.1", 6112, false],
  ["169.254.0.1", 6112, false],
  ["198.18.0.1", 6112, false],
  ["224.0.0.1", 6112, false],
  ["012.0.0.1", 6112, false],
  ["8.8.8.256", 6112, false],
  ["::1", 6112, false],
  ["example.com", 6112, false],
])("refuses unsafe TCP destination %s:%s", (host, port, expected) => {
  expect(allowedDestination(host, port)).toBe(expected);
});
test.each([
  ["File12.ArenaNetworks.com", true],
  ["GEODC.ArenaNetworks.com.", true],
  ["guildwars.com", true],
  ["notarenanetworks.com", false],
  ["arenanetworks.com.example.com", false],
  ["127.0.0.1", false],
])("refuses unsafe DNS name %s", (name, expected) => {
  expect(allowedName(name)).toBe(expected);
});

test("refuses destinations and DNS names before opening network traffic", async () => {
  const network = createGameNetwork(() => {
    throw new Error("Unexpected socket event");
  });
  expect(() => network.connect(1, 1, "127.0.0.1:6112")).toThrow("refused");
  await expect(network.resolve("example.com")).rejects.toThrow("refused");
});

test("accepts a late ack after close while refusing foreign socket operations", async () => {
  const destination = await echoServer();
  const events: SocketEvent[] = [];
  let resolveOpen: () => void = () => {};
  let resolveData: () => void = () => {};
  let resolveClose: () => void = () => {};
  const open = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  const data = new Promise<void>((resolve) => {
    resolveData = resolve;
  });
  const close = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const network = createGameNetwork(
    (owner, event) => {
      expect(owner).toBe(10);
      events.push(event);
      if (event.kind === "open") resolveOpen();
      if (event.kind === "data") {
        network.ack(owner, event.id, event.bytes.length);
        resolveData();
      }
      if (event.kind === "close") resolveClose();
    },
    (host, port) => `${host}:${port}` === destination,
  );
  cleanup.push(() => network.closeWindow(10));
  expect(network.hasConnected(10)).toBe(false);
  expect(network.hasConnected(20)).toBe(false);
  network.connect(10, 7, destination);
  await open;
  expect(network.hasConnected(10)).toBe(true);
  expect(() => network.write(20, 7, new Uint8Array([9]))).toThrow("does not own");
  expect(() => network.close(20, 7)).toThrow("does not own");
  expect(network.ack(20, 7, 1)).toBeUndefined();
  network.write(10, 7, new Uint8Array([1, 2, 3]));
  await data;
  network.close(10, 7);
  await close;
  expect(() => network.ack(10, 7, 3)).not.toThrow();
  expect(network.ack(20, 7, 3)).toBeUndefined();
  network.closeWindow(10);
  expect(events).toEqual([
    { id: 7, kind: "open" },
    { id: 7, kind: "data", bytes: new Uint8Array([1, 2, 3]) },
    { id: 7, kind: "close" },
  ]);
  expect(network.hasConnected(10)).toBe(false);
  expect(() => network.write(10, 7, new Uint8Array([4]))).toThrow("does not own");
});

test("closes a connection when a write exceeds the buffer bound", async () => {
  const destination = await echoServer();
  let resolveOpen: () => void = () => {};
  let resolveClose: () => void = () => {};
  const open = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const network = createGameNetwork(
    (_owner, event) => {
      if (event.kind === "open") resolveOpen();
      if (event.kind === "close") resolveClose();
    },
    (host, port) => `${host}:${port}` === destination,
  );
  cleanup.push(() => network.closeWindow(1));
  network.connect(1, 1, destination);
  await open;
  expect(() => network.write(1, 1, new Uint8Array(BUFFER_LIMIT + 1))).toThrow("buffer limit");
  await closed;
});

test("10,000 reconnects do not retain sockets and unknown or late acknowledgements are no-ops", async () => {
  const destination = await echoServer();
  let closed: () => void = () => {};
  const network = createGameNetwork(
    (_owner, event) => {
      if (event.kind === "close") closed();
    },
    (host, port) => `${host}:${port}` === destination,
  );
  cleanup.push(() => network.closeWindow(1));
  expect(network.ack(1, 10001, 1)).toBeUndefined();
  for (let id = 1; id <= 10000; id++) {
    const close = new Promise<void>((done) => {
      closed = done;
    });
    network.connect(1, id, destination);
    network.close(1, id);
    await close;
    expect(network.socketCount(1)).toBe(0);
    expect(network.ack(1, id, 1)).toBeUndefined();
  }
}, 60_000);
