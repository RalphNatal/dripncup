/**
 * Every spec imports `test` and `expect` from here, not from
 * @playwright/test (tests/e2e-isolation.test.ts enforces it). The `test`
 * adds one automatic fixture, the page guard: every page a test opens --
 * through the `page` fixture or any context it makes with
 * `browser.newContext()` -- is watched, and the test fails if one
 *
 *   - throws an uncaught error (Playwright's `pageerror`; React reports a
 *     hydration mismatch this way, "Minified React error #418" in a
 *     production build, "Hydration failed ..." in dev);
 *   - logs a console error about hydration or a React error; or
 *   - ends the test with HTML nesting browsers or React get wrong: links or
 *     buttons inside links or buttons, a block inside a <p>, a label in a
 *     label. (A <div> in a <p> from the server is split by the HTML parser
 *     and shows up as a hydration mismatch instead.)
 *
 * A test that provokes an error on purpose lists it in `allowedPageErrors`:
 *   test.use({ allowedPageErrors: [/Failed to fetch/] });
 */
import { test as base, type Browser, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";

export * from "@playwright/test";

/** Console errors that always fail a test (other console errors, e.g. a 404 for a missing image, do not). */
const FATAL_CONSOLE = [
  /hydrat/i,
  /did not match/i,
  /server rendered (html|text)/i,
  /Minified React error/i,
  /Uncaught/i,
  /cannot be a (descendant|child) of/i,
  /In HTML, /i,
];

/** Invalid nesting, checked on every page still open when the test ends. */
const NESTING_SELECTORS = [
  "a a",
  "a button",
  "button a",
  "button button",
  "a select",
  "button select",
  "a textarea",
  "button textarea",
  "a input:not([type=hidden])",
  "button input:not([type=hidden])",
  "label label",
  "p div",
  "p p",
  "p ul",
  "p ol",
  "p table",
  "p section",
  "p h1, p h2, p h3, p h4, p h5, p h6",
];

interface PageProblem {
  url: string;
  kind: "uncaught error" | "console error" | "invalid nesting";
  text: string;
}

export const test = base.extend<{ allowedPageErrors: RegExp[]; pageGuard: void }>({
  allowedPageErrors: [[], { option: true }],

  pageGuard: [
    async ({ context, browser, allowedPageErrors }, run) => {
      const problems: PageProblem[] = [];
      const pages = new Set<Page>();
      const allowed = (text: string) => allowedPageErrors.some((pattern) => pattern.test(text));

      const watchPage = (page: Page) => {
        if (pages.has(page)) return;
        pages.add(page);
        page.on("pageerror", (error) => {
          const text = `${error.name}: ${error.message}`;
          if (!allowed(text)) problems.push({ url: page.url(), kind: "uncaught error", text });
        });
        page.on("console", (message: ConsoleMessage) => {
          if (message.type() !== "error") return;
          const text = message.text();
          if (FATAL_CONSOLE.some((pattern) => pattern.test(text)) && !allowed(text)) {
            problems.push({ url: page.url(), kind: "console error", text: text.slice(0, 2000) });
          }
        });
      };
      const watchContext = (watched: BrowserContext) => {
        watched.pages().forEach(watchPage);
        watched.on("page", watchPage);
      };

      // Contexts a test makes itself (a second customer, a barista window).
      const original = browser.newContext.bind(browser);
      const patched: Browser["newContext"] = async (...args) => {
        const made = await original(...args);
        watchContext(made);
        return made;
      };
      browser.newContext = patched;
      watchContext(context);

      try {
        await run();
      } finally {
        browser.newContext = original;
      }

      for (const page of pages) {
        if (page.isClosed()) continue;
        const nested = await page
          .evaluate((selectors) => {
            const found: string[] = [];
            for (const selector of selectors) {
              for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 3)) {
                found.push(`${selector}: ${element.outerHTML.slice(0, 160)}`);
              }
            }
            return found;
          }, NESTING_SELECTORS)
          .catch(() => [] as string[]);
        for (const text of nested) problems.push({ url: page.url(), kind: "invalid nesting", text });
      }

      if (problems.length) {
        throw new Error(
          `The page guard found ${problems.length} problem(s) on pages this test visited:\n` +
            problems.map((p) => `  [${p.kind}] ${p.url}\n    ${p.text.replace(/\n/g, "\n    ")}`).join("\n"),
        );
      }
    },
    { auto: true },
  ],
});
