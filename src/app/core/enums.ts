/**
 * Mirrors the backend's src/config/enums.js. Keep the two in sync.
 */
export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'cashier', 'waiter', 'chef', 'inventory_clerk'] as const;
export type Role = (typeof MEMBER_ROLES)[number];

export const UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'oz', 'lb', 'fl_oz', 'bunch', 'portion'] as const;

export const STOCK_MOVEMENT_TYPES = [
  'purchase_receipt', 'sale_deduction', 'sale_reversal', 'adjustment', 'waste',
  'transfer_in', 'transfer_out', 'opening_balance', 'return_to_supplier',
] as const;

export const DIETARY_TAGS = ['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'halal', 'kosher', 'spicy'] as const;
export const ALLERGENS = [
  'gluten', 'dairy', 'eggs', 'peanuts', 'tree_nuts', 'soy', 'fish',
  'shellfish', 'sesame', 'mustard', 'celery', 'sulphites', 'lupin', 'molluscs',
] as const;

export const PO_STATUS = ['draft', 'submitted', 'partially_received', 'received', 'closed', 'cancelled'] as const;
export const SUPPLIER_PAYMENT_TERMS = ['prepaid', 'cod', 'net_7', 'net_15', 'net_30', 'net_60'] as const;

export const TABLE_STATUS = ['available', 'occupied', 'reserved', 'cleaning', 'out_of_service'] as const;
export type TableStatus = (typeof TABLE_STATUS)[number];

export const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const ORDER_SOURCES = ['pos', 'qr', 'online', 'phone'] as const;
export const ORDER_STATUS = ['open', 'in_progress', 'ready', 'served', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];
/** Orders that are still on the floor (not completed or cancelled). */
export const ACTIVE_ORDER_STATUS: OrderStatus[] = ['open', 'in_progress', 'ready', 'served'];
export const ORDER_ITEM_STATUS = ['pending', 'sent', 'preparing', 'ready', 'served', 'cancelled'] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUS)[number];
export const ORDER_PAYMENT_STATUS = ['unpaid', 'partially_paid', 'paid', 'refunded'] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUS)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'mobile_wallet', 'bank_transfer', 'voucher', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Human label for any snake_case enum value: "inventory_clerk" → "Inventory clerk". */
export function enumLabel(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral';

/** Colour tone for a status value, used by <app-status-pill>. */
export const STATUS_TONES: Record<string, Tone> = {
  // order
  open: 'info',
  in_progress: 'primary',
  ready: 'warning',
  served: 'success',
  completed: 'neutral',
  cancelled: 'danger',
  // order line
  pending: 'neutral',
  sent: 'info',
  preparing: 'primary',
  // payment status
  unpaid: 'danger',
  partially_paid: 'warning',
  paid: 'success',
  refunded: 'neutral',
  // table
  available: 'success',
  occupied: 'primary',
  reserved: 'warning',
  cleaning: 'info',
  out_of_service: 'neutral',
  // purchase order
  draft: 'neutral',
  submitted: 'info',
  partially_received: 'warning',
  received: 'success',
  closed: 'neutral',
  // generic
  active: 'success',
  invited: 'info',
  suspended: 'danger',
  failed: 'danger',
  voided: 'neutral',
};
