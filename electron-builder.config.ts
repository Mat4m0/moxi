import type { Configuration } from "electron-builder";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";
import { join } from "node:path";

const config: Configuration = {
  appId: "io.github.mat4m0.moxi",
  productName: "Moxi",
  directories: { app: "apps/desktop", output: "out", buildResources: "build" },
  files: [
    "dist/**",
    "package.json",
    "!node_modules/**",
    { from: "../launcher/dist", to: "renderers/launcher", filter: ["**/*"] },
    { from: "../game/dist", to: "renderers/game", filter: ["**/*"] },
    { from: "../plugin-host/dist", to: "renderers/plugin-host", filter: ["**/*"] },
  ],
  extraResources: [
    { from: "THIRD-PARTY-NOTICES.md", to: "licenses/THIRD-PARTY-NOTICES.md" },
    { from: "packages/ui/src/assets/fonts/COPYING-INTER", to: "licenses/COPYING-INTER" },
    { from: "packages/ui/src/assets/fonts/COPYING-QUALITYPE", to: "licenses/COPYING-QUALITYPE" },
  ],
  asar: true,
  npmRebuild: false,
  afterPack: async ({ appOutDir, electronPlatformName }) => {
    const executable = join(
      appOutDir,
      electronPlatformName === "darwin"
        ? "Moxi.app"
        : electronPlatformName === "win32"
          ? "Moxi.exe"
          : "moxi",
    );
    await flipFuses(executable, {
      version: FuseVersion.V1,
      strictlyRequireAllFuses: true,
      // Arbitrary scripts must not run with the app's privileges.
      [FuseV1Options.RunAsNode]: false,
      // Avoid Chromium creating a second Safe Storage Keychain item.
      [FuseV1Options.EnableCookieEncryption]: false,
      // NODE_OPTIONS is read before the app can check its environment.
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      // A Main debugger can read credentials directly from memory.
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // Validate the archive on every launch, beyond the bundle seal.
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      // An app directory must not bypass archive integrity checks.
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      // A separate browser snapshot would put executable code outside ASAR.
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      // Renderers use moxi://app and need no extra file:// privileges.
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      // WebAssembly trap handlers avoid a bounds check on every heap access.
      [FuseV1Options.WasmTrapHandlers]: true,
    });
  },
  mac: {
    target: [
      { target: "zip", arch: ["arm64"] },
      { target: "dmg", arch: ["arm64"] },
    ],
    identity: "-",
    notarize: false,
    category: "public.app-category.games",
  },
  dmg: { sign: false },
  win: { target: [{ target: "nsis", arch: ["x64"] }], signExecutable: false },
  nsis: { oneClick: true, perMachine: false, allowElevation: false },
  linux: {
    executableName: "moxi",
    target: [{ target: "AppImage", arch: ["x64"] }],
    category: "Game",
  },
  publish: null,
};

export default config;
