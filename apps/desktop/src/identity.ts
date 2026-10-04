export function resolveIdentity(packaged: boolean): {
  productName: string;
  appId: string;
  channel: "dev" | "beta" | "stable";
} {
  return packaged
    ? { productName: "Moxi", appId: "io.github.mat4m0.moxi", channel: "stable" }
    : { productName: "Moxi Dev", appId: "io.github.mat4m0.moxi.dev", channel: "dev" };
}
