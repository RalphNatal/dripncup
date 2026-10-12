/**
 * iOS launch screens ("splash screens") for the installed app.
 *
 * iOS shows an `apple-touch-startup-image` while an installed web app starts,
 * but only one whose pixel size and media query match the device exactly;
 * otherwise it shows a blank white screen. One entry per current iPhone and
 * iPad screen size, portrait (plus landscape on iPads, which are often
 * used sideways). Shared by `npm run brand:assets`, which draws the images,
 * and the root layout, which links them.
 */
export interface SplashScreen {
  /** CSS pixels, portrait. */
  width: number;
  height: number;
  pixelRatio: 2 | 3;
  /** Also draw a landscape image (iPads). */
  landscape?: boolean;
}

export const SPLASH_SCREENS: readonly SplashScreen[] = [
  { width: 375, height: 667, pixelRatio: 2 }, // iPhone SE (2nd/3rd gen), 8
  { width: 414, height: 736, pixelRatio: 3 }, // iPhone 8 Plus
  { width: 375, height: 812, pixelRatio: 3 }, // iPhone X, XS, 11 Pro, 12/13 mini
  { width: 414, height: 896, pixelRatio: 2 }, // iPhone XR, 11
  { width: 414, height: 896, pixelRatio: 3 }, // iPhone XS Max, 11 Pro Max
  { width: 390, height: 844, pixelRatio: 3 }, // iPhone 12, 13, 14
  { width: 428, height: 926, pixelRatio: 3 }, // iPhone 12/13 Pro Max, 14 Plus
  { width: 393, height: 852, pixelRatio: 3 }, // iPhone 14 Pro, 15, 15 Pro, 16
  { width: 430, height: 932, pixelRatio: 3 }, // iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 402, height: 874, pixelRatio: 3 }, // iPhone 16 Pro, 17
  { width: 440, height: 956, pixelRatio: 3 }, // iPhone 16 Pro Max, 17 Pro Max
  { width: 744, height: 1133, pixelRatio: 2, landscape: true }, // iPad mini (6th gen+)
  { width: 810, height: 1080, pixelRatio: 2, landscape: true }, // iPad 10.2"
  { width: 820, height: 1180, pixelRatio: 2, landscape: true }, // iPad Air, iPad (10th gen)
  { width: 834, height: 1194, pixelRatio: 2, landscape: true }, // iPad Pro 11"
  { width: 1024, height: 1366, pixelRatio: 2, landscape: true }, // iPad Pro 12.9"
];

export interface SplashImage {
  /** Public path of the PNG. */
  url: string;
  /** Pixel size of the PNG. */
  pixelWidth: number;
  pixelHeight: number;
  media: string;
}

/** Every image to draw and link: each screen portrait, and landscape where flagged. */
export function splashImages(): SplashImage[] {
  return SPLASH_SCREENS.flatMap((screen) => {
    const orientations: Array<"portrait" | "landscape"> = screen.landscape ? ["portrait", "landscape"] : ["portrait"];
    return orientations.map((orientation) => {
      const portrait = orientation === "portrait";
      const pixelWidth = (portrait ? screen.width : screen.height) * screen.pixelRatio;
      const pixelHeight = (portrait ? screen.height : screen.width) * screen.pixelRatio;
      return {
        url: `/splash/apple-splash-${pixelWidth}x${pixelHeight}.png`,
        pixelWidth,
        pixelHeight,
        // device-width/height are always the portrait values on iOS.
        media:
          `(device-width: ${screen.width}px) and (device-height: ${screen.height}px) and ` +
          `(-webkit-device-pixel-ratio: ${screen.pixelRatio}) and (orientation: ${orientation})`,
      };
    });
  });
}
