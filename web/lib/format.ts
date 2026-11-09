const YOCTO_PER_NEAR = 10n ** 24n;

/** Convert a yoctoNEAR string to a NEAR number (display only, never for math sent on chain). */
export function yoctoToNear(yocto: string | bigint): number {
  const v = typeof yocto === "bigint" ? yocto : BigInt(yocto);
  const whole = v / YOCTO_PER_NEAR;
  const frac = v % YOCTO_PER_NEAR;
  return Number(whole) + Number(frac / 10n ** 18n) / 1e6;
}

export function formatNear(value: number, digits = 2): string {
  if (value === 0) return "0";
  if (value < 0.01) return "<0.01";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: digits })}%`;
}
