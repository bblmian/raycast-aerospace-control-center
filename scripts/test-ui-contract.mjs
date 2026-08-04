import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controlCenter = readFileSync(new URL("../src/control-center.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/utils/theme.ts", import.meta.url), "utf8");

assert.match(theme, /CONTROL_GRID_COLUMNS = 8/);
assert.match(theme, /CONTROL_GRID_INSET = Grid\.Inset\.Zero/);
assert.match(theme, /grid-templates\/\$\{source\}\.png/);
assert.match(theme, /tintColor: Color\.PrimaryText/);
assert.doesNotMatch(theme, /grid-icons\//);
assert.doesNotMatch(controlCenter, /columns=\{(?:6|7|8)\}/);
assert.doesNotMatch(controlCenter, /QuickCommandsView|QUICK_COMMANDS/);

const controlSections = [...controlCenter.matchAll(/<Grid\.Section[\s\S]*?columns=\{([^}]+)\}/g)];
assert.ok(controlSections.length >= 4, "expected the Control Center grid sections");
for (const section of controlSections) {
  assert.equal(section[1], "CONTROL_GRID_COLUMNS", "every Grid section must use the shared column count");
}

console.log("✓ Control Center uses theme-aware monochrome template icons");
console.log("✓ Every Grid section shares the same columns and native inset");
console.log("✓ The obsolete hard-coded Quick Actions menu is absent");
