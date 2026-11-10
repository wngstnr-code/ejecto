const YOCTO_PER_NEAR = 10n ** 24n;
/** Ejecto coins use 18 decimals (fixed by the factory). */
export const TOKEN_DECIMALS = 18;

/** Convert a yoctoNEAR string to a NEAR number (display only, never for math sent on chain). */
export function yoctoToNear(yocto: string | bigint): number {
  const v = typeof yocto === "bigint" ? yocto : BigInt(yocto);
  const whole = v / YOCTO_PER_NEAR;
  const frac = v % YOCTO_PER_NEAR;
  return Number(whole) + Number(frac) / 1e24;
}

/** Convert raw token units (18 decimals) to a number (display only). */
export function unitsToTokens(units: string | bigint): number {
  const v = typeof units === "bigint" ? units : BigInt(units);
  const base = 10n ** BigInt(TOKEN_DECIMALS);
  return Number(v / base) + Number(v % base) / 10 ** TOKEN_DECIMALS;
}

/**
 * Parse a decimal string into integer base units, exactly (no floating point).
 * Returns null for anything that is not a plain non-negative decimal number.
 */
export function parseUnits(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [whole, frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export const parseNear = (text: string) => parseUnits(text, 24);
export const parseTokens = (text: string) => parseUnits(text, TOKEN_DECIMALS);

/** Exact decimal string of base units, trailing zeros trimmed (for "max" buttons and inputs). */
export function formatUnitsExact(units: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${units / base}.${frac}` : `${units / base}`;
}

export function formatNear(value: number, digits = 2): string {
  if (value === 0) return "0";
  if (value < 0.01) return "<0.01";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

const SUB = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Tiny prices with a zero count subscript, the usual crypto style: 0.00000002 becomes "0.0₇2".
 * Larger values get 4 significant digits.
 */
export function formatPrice(value: number): string {
  if (value === 0) return "0";
  if (value >= 0.001) return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  const exp = Math.floor(Math.log10(value)); // e.g. -8
  const zeros = -exp - 1;
  const digits = Math.round(value * 10 ** (-exp + 2)).toString().replace(/0+$/, "") || "0";
  const count = String(zeros)
    .split("")
    .map((d) => SUB[Number(d)])
    .join("");
  return `0.0${count}${digits}`;
}

/** Compact amounts: 1,234 / 12.3K / 4.56M / 7.8B. */
export function formatCompact(value: number): string {
  if (value === 0) return "0";
  if (value < 0.01) return "<0.01";
  if (value < 10_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: digits })}%`;
}

export function shortAccount(id: string, max = 22): string {
  if (id.length <= max) return id;
  return `${id.slice(0, max - 8)}...${id.slice(-6)}`;
}
