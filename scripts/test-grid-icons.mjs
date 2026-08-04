import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { inflateSync } from "node:zlib";

const ICON_DIRECTORY = new URL("../assets/grid-templates/", import.meta.url);
const EXPECTED_CANVAS = 256;
const MAX_GLYPH_SIZE = 72;
// Raycast centers the image in a 100px column, but paints a 91px tile at its
// top-left. 116.5 / 256 * 100 = 45.5, the center of that visible tile.
const VISIBLE_TILE_OPTICAL_CENTER = 116.5;
const CENTER_TOLERANCE = 0.5;

function decodeRgbaPng(path) {
  const png = readFileSync(path);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${basename(path)} is not PNG`);

  let offset = 8;
  let width;
  let height;
  const compressed = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, `${basename(path)} must use 8-bit channels`);
      assert.equal(data[9], 6, `${basename(path)} must use RGBA color`);
      assert.equal(data[12], 0, `${basename(path)} must not be interlaced`);
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  assert.equal(width, EXPECTED_CANVAS, `${basename(path)} canvas width changed`);
  assert.equal(height, EXPECTED_CANVAS, `${basename(path)} canvas height changed`);

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const rawValue = raw[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      let value;
      if (filter === 0) value = rawValue;
      else if (filter === 1) value = rawValue + left;
      else if (filter === 2) value = rawValue + above;
      else if (filter === 3) value = rawValue + Math.floor((left + above) / 2);
      else if (filter === 4) {
        const prediction = left + above - upperLeft;
        const leftDistance = Math.abs(prediction - left);
        const aboveDistance = Math.abs(prediction - above);
        const upperLeftDistance = Math.abs(prediction - upperLeft);
        const predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
        value = rawValue + predictor;
      } else {
        assert.fail(`${basename(path)} uses unsupported PNG filter ${filter}`);
      }
      pixels[y * stride + x] = value & 0xff;
    }
    sourceOffset += stride;
  }

  return { width, height, pixels };
}

function alphaBounds(path) {
  const { width, height, pixels } = decodeRgbaPng(path);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert.ok(maxX >= 0, `${basename(path)} has no visible pixels`);
  return { minX, minY, maxX, maxY };
}

const icons = readdirSync(ICON_DIRECTORY)
  .filter((name) => name.endsWith(".png"))
  .sort();
assert.ok(icons.length >= 20, "expected the complete Control Center icon set");

for (const icon of icons) {
  const path = join(ICON_DIRECTORY.pathname, icon);
  const bounds = alphaBounds(path);
  const glyphWidth = bounds.maxX - bounds.minX + 1;
  const glyphHeight = bounds.maxY - bounds.minY + 1;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  assert.ok(glyphWidth <= MAX_GLYPH_SIZE, `${icon} is too wide: ${glyphWidth}px`);
  assert.ok(glyphHeight <= MAX_GLYPH_SIZE, `${icon} is too tall: ${glyphHeight}px`);
  assert.ok(
    Math.abs(centerX - VISIBLE_TILE_OPTICAL_CENTER) <= CENTER_TOLERANCE,
    `${icon} is not horizontally aligned to the visible tile: ${centerX}`,
  );
  assert.ok(
    Math.abs(centerY - VISIBLE_TILE_OPTICAL_CENTER) <= CENTER_TOLERANCE,
    `${icon} is not vertically aligned to the visible tile: ${centerY}`,
  );
}

console.log(`✓ ${icons.length} Grid icons stay proportionate and optically centered in their visible tiles`);
