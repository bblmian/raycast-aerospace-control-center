import { Color, Grid, Icon } from "@raycast/api";

export const PALETTE = {
  slate: "#8290A3",
  blue: "#7D91AD",
  indigo: "#8887AA",
  teal: "#789B98",
  green: "#819B86",
  amber: "#AA9878",
  coral: "#AA7F79",
  secondary: "#858A93",
};

export function coloredIcon(source: Icon, tintColor?: string) {
  void tintColor; // Legacy callers keep their semantic status input; rendering is intentionally monochrome.
  return { source, tintColor: Color.PrimaryText };
}

export type CompactGridIcon =
  | "bolt"
  | "code"
  | "focus"
  | "heartbeat"
  | "layout"
  | "list"
  | "maintenance"
  | "menu-bar"
  | "monitor"
  | "pause"
  | "power"
  | "reload"
  | "resize"
  | "settings"
  | "status"
  | "status-ring"
  | "terminal"
  | "tools"
  | "window"
  | "workspaces"
  | "keyboard";

/**
 * Raycast renders a built-in Icon as a large Grid glyph and doesn't expose a
 * per-item icon-size prop. These theme-tinted template assets use their own
 * optical safe area, so the Grid must not apply another inset. Their artwork
 * is compensated for Raycast centering the 256px image in the 100px column
 * box, while the visible rounded tile occupies the top-left 91px. Keep that
 * geometry locked with scripts/test-grid-icons.mjs.
 */
export const CONTROL_GRID_COLUMNS = 8;
export const CONTROL_GRID_INSET = Grid.Inset.Zero;

export function compactGridIcon(source: CompactGridIcon) {
  return { source: `grid-templates/${source}.png`, tintColor: Color.PrimaryText };
}
