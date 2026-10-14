// PB10 only: moxi's packaging config plus a .deb target and a selectable AppImage toolset.
// PB10_TOOLSET = "0.0.0" (legacy FUSE2 runtime, the default) or "1.0.3" (static runtime).
// PB10_TARGETS = comma list, e.g. "deb,AppImage".
import type { Configuration } from "electron-builder";
import base from "../../electron-builder.config.ts";

const toolset = (process.env.PB10_TOOLSET ?? "0.0.0") as "0.0.0" | "1.0.3";
const targets = (process.env.PB10_TARGETS ?? "deb,AppImage").split(",");

const config: Configuration = {
  ...base,
  directories: { ...base.directories, output: process.env.PB10_OUT ?? "out" },
  toolsets: { appimage: toolset },
  linux: {
    ...base.linux,
    target: targets.map((target) => ({ target, arch: ["x64"] })),
    // FpmTarget needs a maintainer; the probe package is never published.
    maintainer: "Moxi probe <noreply@example.invalid>",
    synopsis: "Moxi architecture probe PB10",
    description: "Moxi architecture probe PB10 (never published).",
  },
};

export default config;
