import { expect, test } from "vite-plus/test";
import { accessibleForeground } from "./color";
import { appearanceVariables } from "./index";

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

test.each(["classic", "obsidian"] as const)(
  "the %s look at the default opacity changes only the opacity",
  (uiStyle) => {
    expect(appearanceVariables({ uiStyle, uiPanelOpacity: 94, uiFont: "inter" })).toEqual({
      "--ui-panel-opacity": "0.94",
    });
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
