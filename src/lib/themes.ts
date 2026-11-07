/**
 * Skin registry — the visual identities DBDog ships beyond the classic
 * light/dark pair. A skin is a set of shadcn-style HSL tokens in
 * index.css (`[data-theme='<id>']`); AG Grid / CodeMirror keep following
 * the light/dark flag via `resolvedTheme`, so no component knows skins
 * exist. `swatch` drives the settings preview chips.
 */

export type SkinId =
  | "puppy"
  | "sakura"
  | "paper"
  | "nord"
  | "dracula"
  | "catppuccin"
  | "terminal";

export interface SkinDef {
  id: SkinId;
  /** UI-facing names; zh picked by language, en otherwise. */
  name: string;
  nameEn: string;
  dark: boolean;
  /** [background, primary, accent] — HSL triplets as CSS color strings for swatches. */
  swatch: [string, string, string];
}

export const SKINS: SkinDef[] = [
  {
    id: "puppy",
    name: "奶油橙",
    nameEn: "Puppy",
    dark: false,
    swatch: ["hsl(36 60% 96%)", "hsl(22 90% 52%)", "hsl(30 85% 88%)"],
  },
  {
    id: "sakura",
    name: "樱花粉",
    nameEn: "Sakura",
    dark: false,
    swatch: ["hsl(340 45% 97%)", "hsl(342 78% 58%)", "hsl(345 70% 90%)"],
  },
  {
    id: "paper",
    name: "纸墨",
    nameEn: "Paper",
    dark: false,
    swatch: ["hsl(42 38% 94%)", "hsl(20 55% 40%)", "hsl(40 50% 85%)"],
  },
  {
    id: "nord",
    name: "Nord",
    nameEn: "Nord",
    dark: true,
    swatch: ["hsl(220 16% 16%)", "hsl(193 43% 67%)", "hsl(219 13% 26%)"],
  },
  {
    id: "dracula",
    name: "Dracula",
    nameEn: "Dracula",
    dark: true,
    swatch: ["hsl(231 15% 18%)", "hsl(265 89% 78%)", "hsl(191 97% 77%)"],
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    nameEn: "Catppuccin",
    dark: true,
    swatch: ["hsl(240 21% 15%)", "hsl(267 84% 81%)", "hsl(189 71% 73%)"],
  },
  {
    id: "terminal",
    name: "终端绿",
    nameEn: "Terminal",
    dark: true,
    swatch: ["hsl(150 30% 6%)", "hsl(120 85% 50%)", "hsl(120 40% 18%)"],
  },
];

export const isSkinTheme = (theme: string): theme is SkinId =>
  SKINS.some((s) => s.id === theme);

export const skinById = (theme: string): SkinDef | undefined =>
  SKINS.find((s) => s.id === theme);
