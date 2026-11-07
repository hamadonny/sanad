import type { ar } from './locales/ar.js';

/** Turn the literal-typed Arabic object into a shape of plain strings. */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Every locale must have exactly the same keys as Arabic (the source of truth). */
export type TranslationShape = Widen<typeof ar>;
