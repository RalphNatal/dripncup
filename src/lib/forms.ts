import type { z } from "zod";

/** Zod issues -> "field.path" -> first message, for forms with nested fields. */
export function issuesByPath(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    result[key] ??= issue.message;
  }
  return result;
}
