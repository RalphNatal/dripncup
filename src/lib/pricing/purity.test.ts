import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Checkout (server) must reuse exactly what the product sheet (browser) runs,
 * so this folder may only import from itself. A React, Next or Supabase
 * import here would quietly make one side unable to use it.
 */
describe("src/lib/pricing stays framework-free", () => {
  const dir = join(process.cwd(), "src/lib/pricing");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it.each(sources)("%s imports only sibling modules", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    const specifiers = [...source.matchAll(/(?:import|export)[^'"]*from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const specifier of specifiers) {
      expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\//);
    }
  });
});
