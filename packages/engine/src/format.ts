/** Rupees the way Indian shoppers read them: ₹1,240 · ₹9.80 · ₹1,05,000. */
export function formatRupees(n: number, opts: { decimals?: 'auto' | 0 | 2 } = {}): string {
  const mode = opts.decimals ?? 'auto';
  const rounded = Math.round(n * 100) / 100;
  const whole = Number.isInteger(rounded);
  const digits = mode === 'auto' ? (whole ? 0 : 2) : mode;
  return `₹${rounded.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
