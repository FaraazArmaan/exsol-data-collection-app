export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const fmt = new Intl.NumberFormat('en-IN').format(rupees);
  return fraction === 0
    ? `${sign}₹${fmt}`
    : `${sign}₹${fmt}.${String(fraction).padStart(2, '0')}`;
}

export function formatOrderNo(n: number): string {
  return `S-${String(n).padStart(5, '0')}`;
}
