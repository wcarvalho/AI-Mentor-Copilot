// Copied from app/client/src/theme.ts — kept in sync manually
export const PALETTE = {
  cream: "#FAF6F0",
  parchment: "#F3EDE4",
  sand: "#E8DFCF",
  ink: "#1a1a2e",
  inkLight: "#3d3d5c",
  inkMuted: "#7a7a99",
  amber: "#c87941",
  amberLight: "#e8a96a",
  amberGlow: "rgba(200,121,65,0.12)",
  sage: "#5a7f60",
  sageLight: "#7da882",
  sageBg: "rgba(90,127,96,0.08)",
  rose: "#b85c5c",
  roseLight: "#d48a8a",
  white: "#ffffff",
  teal: "#4a8f8f",
  tealLight: "#6fb3b3",
  tealBg: "rgba(74,143,143,0.08)",
};

export const FONT_HEADING = "'Libre Baskerville', serif";
export const FONT_BODY = "'Source Sans 3', sans-serif";

// Section colors cycle for dynamic model fields
export const SECTION_COLOR_PALETTE = [
  "#9B80E6",   // nice purple
  "#009E73",   // bluish green
  "#D55E00",   // vermillion
  "#2f2f2e",   // black
  "#0072B2",   // blue
  "#E69F00",   // orange
  "#CC79A7",   // reddish purple
  "#186CED",   // google blue
];

export const SECTION_COLORS: Record<string, string> = {
  values: SECTION_COLOR_PALETTE[0],   // nice purple
  beliefs: SECTION_COLOR_PALETTE[1],  // bluish green
  goals: SECTION_COLOR_PALETTE[2],    // vermillion
  worldModel: SECTION_COLOR_PALETTE[3], // black
  people: "#CC79A7",                  // reddish purple
};
