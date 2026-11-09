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
  | "nord"
  | "catppuccin"
  | "terminal"
  | "collieNight"
  | "collieDay";

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
    id: "nord",
    name: "Nord",
    nameEn: "Nord",
    dark: true,
    swatch: ["hsl(220 16% 16%)", "hsl(193 43% 67%)", "hsl(219 13% 26%)"],
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
  {
    id: "collieNight",
    name: "边牧·夜巡",
    nameEn: "Collie Night",
    dark: true,
    swatch: ["hsl(0 0% 7%)", "hsl(0 0% 92%)", "hsl(0 0% 18%)"],
  },
  {
    id: "collieDay",
    name: "边牧·白天",
    nameEn: "Collie Day",
    dark: false,
    swatch: ["hsl(0 0% 96%)", "hsl(0 0% 12%)", "hsl(0 0% 88%)"],
  },
];

export const isSkinTheme = (theme: string): theme is SkinId =>
  SKINS.some((s) => s.id === theme);

export const skinById = (theme: string): SkinDef | undefined =>
  SKINS.find((s) => s.id === theme);
