// Rupees on screen from paise, the same rule as the web and the receipts. No floating point.
/** "₹1,23,456.50" from paise (the same rule as the web and the receipts). */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = String(Math.floor(abs / 100));
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${rest ? `${rest},` : ''}${whole.slice(-3)}.${String(abs % 100).padStart(2, '0')}`;
}
