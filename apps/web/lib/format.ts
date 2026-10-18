/** Cents → "$12.34". Money is always shown to the cent so shares visibly sum. */
export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** Whole dollars for per-person prices ("$63"). */
export const usd0 = (cents: number): string => `$${Math.floor(cents / 100)}`;
