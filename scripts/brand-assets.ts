/**
 * `npm run brand:assets`: every brand image the app ships, from ONE source.
 *
 * Source: brand/logo.svg (or brand/logo.png, at least 1024 px, transparent
 * background). Swapping in the cafe's real logo is: replace that file, run
 * this script, commit what it writes. Colours come from BRAND_COLORS in
 * src/lib/brand.ts (the same values as the CSS tokens).
 *
 * Writes:
 *   public/icons/icon-192.png, icon-512.png          manifest, purpose "any"
 *   public/icons/icon-maskable-192.png, -512.png      manifest, purpose "maskable"
 *                                                     (logo inside the 80% safe zone)
 *   public/icons/badge-96.png                         Android notification badge
 *                                                     (white silhouette, transparent)
 *   public/icons/shortcut-{menu,orders,rewards}.png   manifest shortcuts
 *   public/splash/apple-splash-<w>x<h>.png            iOS launch screens
 *                                                     (src/lib/pwa/splash-screens.ts)
 *   src/app/favicon.ico                               16, 32 and 48 px
 *   src/app/apple-icon.png                            180 px, opaque (iOS home screen)
 *   src/app/opengraph-image.png, twitter-image.png    1200 x 630 share card
 *
 * The logo is trimmed to its drawn area first, so any source is centred the
 * same way. Text on the share card and launch screens is typeset in the
 * heading font (Baloo 2, from @fontsource) with the wordmark from BRAND.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { __iconData as cupSoda } from "lucide-react/dist/esm/icons/cup-soda.mjs";
import { __iconData as gift } from "lucide-react/dist/esm/icons/gift.mjs";
import { __iconData as receipt } from "lucide-react/dist/esm/icons/receipt.mjs";
import { ImageResponse } from "next/og";
import { createElement as h } from "react";
import sharp from "sharp";

import { BRAND, BRAND_COLORS, CAFE_ADDRESS } from "../src/lib/brand";
import { splashImages } from "../src/lib/pwa/splash-screens";

const ROOT = process.cwd();
const SOURCES = ["brand/logo.svg", "brand/logo.png"];
const written: string[] = [];

function out(path: string, data: Buffer) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  written.push(`${path} (${(data.length / 1024).toFixed(1)} KB)`);
}

/** The logo, rendered large on transparent and trimmed to what is drawn. */
async function loadLogo(): Promise<Buffer> {
  const source = SOURCES.find((path) => existsSync(join(ROOT, path)));
  if (!source) throw new Error(`No logo found. Put the logo at ${SOURCES.join(" or ")}.`);
  const input = sharp(join(ROOT, source), source.endsWith(".svg") ? { density: 600 } : {});
  const { width = 0, height = 0 } = await input.metadata();
  if (source.endsWith(".png") && Math.min(width, height) < 1024) {
    console.warn(`[brand] ${source} is ${width} x ${height}; 1024 px or more keeps the large icons sharp.`);
  }
  const rendered = await input.resize(2048, 2048, { fit: "inside" }).ensureAlpha().png().toBuffer();
  return sharp(rendered).trim().png().toBuffer();
}

/** The logo scaled to fit a `box` x `box` square. */
function fitLogo(logo: Buffer, box: number) {
  return sharp(logo).resize(Math.round(box), Math.round(box), { fit: "inside" }).png().toBuffer();
}

/** A canvas of `background` with the logo centred, filling `fraction` of the shorter side. */
async function logoOn(logo: Buffer, width: number, height: number, background: string, fraction: number, offsetY = 0) {
  const mark = await fitLogo(logo, Math.min(width, height) * fraction);
  const { width: mw = 0, height: mh = 0 } = await sharp(mark).metadata();
  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{ input: mark, left: Math.round((width - mw) / 2), top: Math.round((height - mh) / 2 + offsetY) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** A rounded-square icon (purpose "any"): background tile, logo with breathing room. */
async function roundedIcon(logo: Buffer, size: number) {
  const radius = Math.round(size * 0.22);
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND_COLORS.sand}"/></svg>`,
  );
  const mark = await fitLogo(logo, size * 0.74);
  const { width: mw = 0, height: mh = 0 } = await sharp(mark).metadata();
  return sharp(tile)
    .composite([{ input: mark, left: Math.round((size - mw) / 2), top: Math.round((size - mh) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** White silhouette of the logo on transparent: Android tints notification badges. */
async function badge(logo: Buffer, size: number) {
  const mark = await fitLogo(logo, size * 0.84);
  const { width: mw = 0, height: mh = 0 } = await sharp(mark).metadata();
  const alpha = await sharp(mark).extractChannel("alpha").toBuffer();
  const white = await sharp({ create: { width: mw, height: mh, channels: 3, background: "#ffffff" } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: white, left: Math.round((size - mw) / 2), top: Math.round((size - mh) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

type IconNode = { node: Array<[string, Record<string, string>]> };

/** A shortcut icon: a lucide glyph in white on a brand circle. */
function shortcutIcon(icon: IconNode, size: number, fill: string) {
  const glyph = icon.node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="24" fill="${fill}"/>
    <g transform="translate(12 12)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** An .ico holding PNG images (every current browser reads PNG-in-ICO). */
async function favicon(logo: Buffer, sizes: number[]) {
  const images = await Promise.all(
    sizes.map(async (size) => {
      const mark = await fitLogo(logo, size);
      return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: mark, gravity: "center" }])
        .png()
        .toBuffer();
    }),
  );
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(sizes[index] >= 256 ? 0 : sizes[index], entry);
    header.writeUInt8(sizes[index] >= 256 ? 0 : sizes[index], entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

function fontFile(pkg: string, file: string): ArrayBuffer {
  const buffer = readFileSync(join(ROOT, "node_modules", pkg, "files", file));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const FONTS = () => [
  { name: "Baloo 2", data: fontFile("@fontsource/baloo-2", "baloo-2-latin-800-normal.woff"), weight: 800 as const, style: "normal" as const },
  { name: "Inter", data: fontFile("@fontsource/inter", "inter-latin-600-normal.woff"), weight: 600 as const, style: "normal" as const },
];

async function render(element: ReturnType<typeof h>, width: number, height: number) {
  const response = new ImageResponse(element, { width, height, fonts: FONTS() });
  return Buffer.from(await response.arrayBuffer());
}

/** The 1200 x 630 share card. */
async function shareCard(logo: Buffer) {
  const mark = await fitLogo(logo, 360);
  const markUri = `data:image/png;base64,${mark.toString("base64")}`;
  const card = h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        padding: "0 80px",
        gap: 64,
        backgroundImage: `linear-gradient(160deg, ${BRAND_COLORS.tealSoft} 0%, ${BRAND_COLORS.sand} 55%, ${BRAND_COLORS.pinkSoft} 100%)`,
        fontFamily: "Inter",
        color: BRAND_COLORS.ink,
      },
    },
    h("img", { src: markUri, width: 360, height: 360, style: { objectFit: "contain" } }),
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", flex: 1 } },
      h(
        "div",
        { style: { fontFamily: "Baloo 2", fontSize: 104, fontWeight: 800, lineHeight: 1, color: BRAND_COLORS.tealDeep, letterSpacing: -2 } },
        BRAND.wordmark,
      ),
      h(
        "div",
        { style: { marginTop: 18, fontFamily: "Baloo 2", fontSize: 52, fontWeight: 800, color: BRAND_COLORS.magentaDeep } },
        BRAND.taglines.primary,
      ),
      h("div", { style: { marginTop: 28, fontSize: 30, fontWeight: 600 } }, "Order ahead for pickup"),
      h(
        "div",
        { style: { marginTop: 6, fontSize: 26, fontWeight: 600, color: "#5d5a56" } },
        `${CAFE_ADDRESS.line1}, ${CAFE_ADDRESS.city}, Hawaiʻi`,
      ),
    ),
  );
  return render(card, 1200, 630);
}

/** The wordmark as a transparent PNG, for the launch screens. */
async function wordmark(width: number) {
  const height = Math.round(width * 0.22);
  const element = h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Baloo 2",
        fontWeight: 800,
        fontSize: Math.round(height * 0.62),
        color: BRAND_COLORS.tealDeep,
      },
    },
    BRAND.wordmark,
  );
  return render(element, width, height);
}

async function splash(logo: Buffer, text: Buffer, width: number, height: number) {
  const short = Math.min(width, height);
  const mark = await fitLogo(logo, short * 0.34);
  const { width: mw = 0, height: mh = 0 } = await sharp(mark).metadata();
  const textWidth = Math.round(short * 0.56);
  const words = await sharp(text).resize({ width: textWidth }).png().toBuffer();
  const { height: th = 0 } = await sharp(words).metadata();
  const top = Math.round((height - (mh + th)) / 2);
  return sharp({ create: { width, height, channels: 4, background: BRAND_COLORS.sand } })
    .composite([
      { input: mark, left: Math.round((width - mw) / 2), top },
      { input: words, left: Math.round((width - textWidth) / 2), top: top + mh },
    ])
    .flatten({ background: BRAND_COLORS.sand })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
}

async function main() {
  const logo = await loadLogo();

  out("public/icons/icon-192.png", await roundedIcon(logo, 192));
  out("public/icons/icon-512.png", await roundedIcon(logo, 512));
  // Maskable: the platform crops to a circle or squircle; only the centre 80%
  // is guaranteed visible, so the logo stays inside 60% of the full bleed.
  out("public/icons/icon-maskable-192.png", await logoOn(logo, 192, 192, BRAND_COLORS.sand, 0.6));
  out("public/icons/icon-maskable-512.png", await logoOn(logo, 512, 512, BRAND_COLORS.sand, 0.6));
  out("public/icons/badge-96.png", await badge(logo, 96));
  out("public/icons/shortcut-menu.png", await shortcutIcon(cupSoda as IconNode, 96, BRAND_COLORS.tealDeep));
  out("public/icons/shortcut-orders.png", await shortcutIcon(receipt as IconNode, 96, BRAND_COLORS.tealDeep));
  out("public/icons/shortcut-rewards.png", await shortcutIcon(gift as IconNode, 96, BRAND_COLORS.magentaDeep));

  // iOS draws its own rounded corners and needs an opaque square.
  out("src/app/apple-icon.png", await logoOn(logo, 180, 180, BRAND_COLORS.sand, 0.74));
  out("src/app/favicon.ico", await favicon(logo, [16, 32, 48]));

  const card = await shareCard(logo);
  out("src/app/opengraph-image.png", card);
  out("src/app/twitter-image.png", card);

  const text = await wordmark(1200);
  for (const image of splashImages()) {
    out(`public${image.url}`, await splash(logo, text, image.pixelWidth, image.pixelHeight));
  }

  console.log(`[brand] Wrote ${written.length} files:\n  ${written.join("\n  ")}`);
}

main().catch((error) => {
  console.error(`[brand] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
