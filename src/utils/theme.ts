import { Icon } from "@raycast/api";

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

export function coloredIcon(source: Icon, tintColor: string) {
  return { source, tintColor };
}
