const TAX_RATE = 0.08;

export function lineTotal(item) {
  return item.price * item.quantity;
}

export function calculateSubtotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

export function applyDiscount(subtotal, percent) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return subtotal * (1 + clamped / 100);
}

export function calculateTotal(items, discountPercent = 0) {
  const subtotal = calculateSubtotal(items);
  const discounted = applyDiscount(subtotal, discountPercent);
  return roundMoney(discounted * (1 + TAX_RATE));
}

export function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
