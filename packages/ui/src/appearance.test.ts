import { expect, test } from "vite-plus/test";
import {
  accessibleForeground,
  appearanceVariables,
  defaultCustomUiTheme,
  readableForeground,
  readableSharedForeground,
} from "./index";

test.each([
  { preferred: "#948E7E", backgrounds: ["#595959"], expected: "#D4CFC2" },
  { preferred: "#000000", backgrounds: ["#000000"], expected: "#777570" },
  { preferred: "#FFFFFF", backgrounds: ["#FFFFFF"], expected: "#777674" },
  { preferred: "#FF0000", backgrounds: ["#000000", "#FFFFFF"], expected: "#EE0201" },
  {
    preferred: "#B7B09F",
    backgrounds: ["#595959", "#0B0B0B", "#292927", "#202225", "#080807"],
    expected: "#D5CFC1",
  },
  { preferred: "#FFFFFF", backgrounds: ["#000000"], expected: "#FFFFFF" },
] as const)(
  "keeps ink readable over $backgrounds without choosing the wrong fallback",
  ({ preferred, backgrounds, expected }) => {
    expect(accessibleForeground(preferred, backgrounds)).toBe(expected);
  },
);

test.each([
  { background: "#FFFFFF", expected: "#171613" },
  { background: "#0B0B0B", expected: "#F7F3E8" },
] as const)("chooses contrasting selection ink over $background", ({ background, expected }) => {
  expect(readableForeground(background)).toBe(expected);
});

test("chooses shared ink when light and dark surfaces rule out either endpoint", () => {
  expect(readableSharedForeground(["#000000", "#FFFFFF"])).toBe("#757575");
});

test.each([
  { material: "classic", uiStyle: "classic" },
  { material: "modern", uiStyle: "obsidian" },
] as const)(
  "avoids changing an untouched $material palette during custom projection",
  ({ material, uiStyle }) => {
    const settings = { uiPanelOpacity: 94, uiFont: "inter" } as const;
    expect(appearanceVariables({ ...settings, uiStyle })).toEqual({ "--ui-panel-opacity": "0.94" });
    expect(
      appearanceVariables({
        ...settings,
        uiStyle: "custom",
        uiCustomTheme: defaultCustomUiTheme(material),
      }),
    ).toEqual({ "--ui-panel-opacity": "0.94" });
  },
);

test("raises muted ink over a bright game at minimum panel opacity without changing opacity", () => {
  expect(
    appearanceVariables({ uiStyle: "classic", uiPanelOpacity: 65, uiFont: "guild-wars" }),
  ).toEqual({
    "--ui-panel-opacity": "0.65",
    "--ui-text-muted": "#DFDACC",
    "--ui-text-faint": "#DFDACC",
  });
});

test("updates command and raised fills together when the custom surface changes", () => {
  const variables = appearanceVariables({
    uiStyle: "custom",
    uiPanelOpacity: 94,
    uiFont: "inter",
    uiCustomTheme: { ...defaultCustomUiTheme("classic"), surface: "#202226", accent: "#FFFFFF" },
  });
  expect(variables["--ui-raised-fill"]).toBe(
    "linear-gradient(color-mix(in srgb, #202226 78%, #D8D2BF), #202226 22%, color-mix(in srgb, #202226 86%, #080807))",
  );
  expect(variables["--ui-command-fill"]).toBe(
    "linear-gradient(color-mix(in srgb, #202226 78%, #D8D2BF), #202226 22%, color-mix(in srgb, #202226 86%, #080807))",
  );
  expect(variables["--ui-primary-ink"]).toBe("#171613");
});
