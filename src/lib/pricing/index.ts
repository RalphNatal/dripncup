/**
 * The pricing and validation engine, shared by the browser and the server.
 *
 * Rules for this folder: pure functions only -- no React, no Supabase, no
 * `Date.now()`, no I/O. Everything it needs is passed in. That is what lets
 * checkout (Phase 4) reuse exactly the code the product sheet runs.
 */
export * from "./constants";
export * from "./order-total";
export * from "./points";
export * from "./price";
export * from "./promo";
export * from "./rewards";
export * from "./rounding";
export * from "./selection";
export * from "./summary";
export * from "./tip";
export * from "./types";
export { isSelectionValid, pluralUnit, validateSelection } from "./validate";
