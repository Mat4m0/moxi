import type { Bridge } from "@moxi/contracts";
declare global {
  interface Window {
    moxi: Bridge<"launcher">;
  }
}
