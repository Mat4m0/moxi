export class WasmError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at byte ${offset}`);
    this.name = "WasmError";
  }
}

export type Reader = {
  bytes: Uint8Array;
  pos: number;
  end: number;
  fail(message: string): never;
  u8(): number;
  take(size: number): Uint8Array;
  leb(bits: number, signed?: boolean): number;
  u32(): number;
  s32(): number;
  s64(): bigint;
  float(size: 4 | 8): number;
  name(): string;
};

export function reader(bytes: Uint8Array, pos = 0, end = bytes.length): Reader {
  return {
    bytes,
    pos,
    end,
    fail(message: string): never {
      throw new WasmError(message, this.pos);
    },
    u8(): number {
      if (this.pos >= this.end) this.fail("Unexpected end");
      const value = this.bytes[this.pos++];
      if (value === undefined) return this.fail("Unexpected end");
      return value;
    },
    take(size: number): Uint8Array {
      if (size > this.end - this.pos) this.fail("Truncated range");
      const value = this.bytes.subarray(this.pos, this.pos + size);
      this.pos += size;
      return value;
    },
    leb(bits: number, signed = false): number {
      let value = 0,
        shift = 0;
      for (let i = 0; i < Math.ceil(bits / 7); i++) {
        const byte = this.u8(),
          payload = byte & 127;
        value += payload * 2 ** shift;
        shift += 7;
        if (!(byte & 128)) {
          if (signed && byte & 64) value -= 2 ** shift;
          if (value < (signed ? -(2 ** (bits - 1)) : 0) || value >= 2 ** (signed ? bits - 1 : bits))
            this.fail("LEB out of range");
          return value;
        }
      }
      return this.fail("LEB too long");
    },
    u32(): number {
      return this.leb(32);
    },
    s32(): number {
      return this.leb(32, true);
    },
    s64(): bigint {
      let value = 0n,
        shift = 0n;
      for (let i = 0; i < 10; i++) {
        const byte = this.u8();
        value |= BigInt(byte & 127) << shift;
        shift += 7n;
        if (!(byte & 128)) {
          if (byte & 64) value -= 1n << shift;
          if (value < -(1n << 63n) || value >= 1n << 63n) this.fail("LEB out of range");
          return value;
        }
      }
      return this.fail("LEB too long");
    },
    float(size: 4 | 8): number {
      const bytes = this.take(size);
      const view = new DataView(bytes.buffer, bytes.byteOffset, size);
      return size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
    },
    name(): string {
      const bytes = this.take(this.u32());
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return this.fail("Invalid UTF-8 name");
      }
    },
  };
}
