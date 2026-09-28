import { OrderItemStatus, OrderPaymentStatus, OrderStatus, OrderType, PaymentMethod, Role, TableStatus } from './enums';

/** Money values from the API are integers in minor units (cents). */
export type Cents = number;

export interface ApiItem<T> {
  data: T;
}

export interface ApiList<T> {
  data: T[];
  meta?: { page: number; limit: number; total?: number };
}

/** Normalised error thrown by the HTTP layer (see auth.interceptor.ts). */
export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin?: boolean;
}

export interface RestaurantAccess {
  tenantId: string;
  name: string;
  slug: string;
  role: Role;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Tenant {
  _id: string;
  name: string;
  slug: string;
  legalName?: string;
  contact?: { email?: string; phone?: string; website?: string };
  address?: Address;
  currency: string;
  timezone: string;
  locale: string;
  tax?: { rate: number; pricesIncludeTax: boolean; serviceChargeRate: number; taxId?: string };
  settings?: {
    inventoryDeductionTrigger: string;
    allowNegativeStock: boolean;
    orderNumberPrefix: string;
    poNumberPrefix: string;
  };
  subscription?: { plan: string; status: string; trialEndsAt?: string };
  status: string;
}

export interface Membership {
  _id: string;
  role: Role;
  displayName?: string;
  status: string;
}

export interface Table {
  id: string;
  name: string;
  section?: string;
  capacity: number;
  status: TableStatus;
  currentOrderId: string | null;
  isActive: boolean;
  isFree?: boolean;
  sortOrder?: number;
  position?: { x: number; y: number };
  /** Waiter responsible for this table this shift. */
  assignedWaiterId?: string | null;
}

/**
 * A per-line ingredient customization, e.g. "+2 egg" or "no onion" on one burger only —
 * the menu recipe itself never changes. 'remove' must reference an ingredient already in
 * that menu item's recipe; 'add' may be any ingredient. Mirrors the backend's
 * orderItemModifierSchema (models/Order.js).
 */
export interface LineModifier {
  inventoryItemId: string;
  name: string;
  unit?: string;
  action: 'add' | 'remove';
  /** 'add' only: extra base units per portion. */
  quantity: number;
  /** Extra charge per portion, in cents. Usually 0 for 'remove'. */
  priceDelta: Cents;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  kitchenStation?: string;
  unitPrice: Cents;
  quantity: number;
  taxRate: number;
  discountAmount?: Cents;
  modifiers?: LineModifier[];
  notes?: string;
  status: OrderItemStatus;
  lineSubtotal: Cents;
  taxAmount: Cents;
  lineTotal: Cents;
  sentAt?: string;
  servedAt?: string;
  cancelReason?: string;
  cancelledAt?: string;
  addedBy?: string;
  inventoryDeducted?: boolean;
  /** Ingredients this line used from stock (base units). */
  inventoryConsumed?: { inventoryItemId: string; quantity: number }[];
}

export interface Order {
  id: string;
  orderNumber: string;
  type: OrderType;
  source: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  tableId: string | { id: string; name: string; section?: string } | null;
  guestCount: number;
  customer?: { name?: string; phone?: string; email?: string; address?: Address; deliveryNotes?: string };
  items: OrderItem[];
  currency: string;
  subtotal: Cents;
  discountTotal: Cents;
  taxTotal: Cents;
  serviceCharge: Cents;
  grandTotal: Cents;
  amountPaid: Cents;
  amountRefunded: Cents;
  tipTotal: Cents;
  balanceDue?: Cents;
  notes?: string;
  /** The staff member who opened the order (the waiter). Set by the server from the token. */
  createdBy?: string;
  /** Waiter serving the order. Null on orders created before this field existed. */
  waiterId?: string | null;
  openedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  orderId: string;
  type: 'payment' | 'refund';
  method: PaymentMethod;
  status: string;
  amount: Cents;
  tipAmount: Cents;
  signedAmount: Cents;
  currency: string;
  cashTendered?: Cents;
  changeDue?: Cents;
  refundOf?: string;
  note?: string;
  provider?: { name?: string; transactionId?: string; authCode?: string; cardBrand?: string; last4?: string };
  processedBy?: string;
  processedAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku?: string;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  reorderQuantity?: number;
  averageCost?: number;
  isLowStock?: boolean;
  stockValue?: Cents;
  isActive: boolean;
}

export interface InventoryItemFull extends InventoryItem {
  categoryId?: string | null;
  barcode?: string;
  description?: string;
  purchaseUnit?: { name?: string; factor: number };
  parLevel?: number;
  lastPurchaseCost?: number;
  preferredSupplierId?: string | null;
  storageLocation?: string;
  isPerishable?: boolean;
  shelfLifeDays?: number;
}

export interface InventoryCategory {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  sortOrder?: number;
}

export interface StockMovement {
  id: string;
  inventoryItemId: string;
  type: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  balanceAfter: number;
  reference?: { kind: string; id?: string; lineIds?: string[] };
  reason?: string;
  occurredAt: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  sortOrder: number;
  isActive: boolean;
  availableFrom?: string;
  availableTo?: string;
}

export interface RecipeLine {
  inventoryItemId: string;
  quantity: number;
  unit?: string;
  wastagePercent?: number;
  note?: string;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  sku?: string;
  imageUrl?: string;
  price: Cents;
  taxRate: number | null;
  tags: string[];
  dietary: string[];
  allergens: string[];
  preparationTimeMinutes?: number;
  kitchenStation?: string;
  isAvailable: boolean;
  isActive: boolean;
  trackInventory: boolean;
  recipe: RecipeLine[];
  sortOrder: number;
}

export interface FoodCost {
  price: Cents;
  cost: Cents;
  foodCostPercent: number;
  lines: { inventoryItemId: string; name?: string; quantity: number; unit?: string; cost: Cents }[];
}

export interface Supplier {
  id: string;
  name: string;
  code?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: Address;
  taxId?: string;
  paymentTerms: string;
  leadTimeDays: number;
  notes?: string;
  isActive: boolean;
}

export interface PurchaseOrderLine {
  id: string;
  inventoryItemId: string;
  itemName: string;
  baseUnit: string;
  purchaseUnit: string;
  conversionFactor: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityOutstanding: number;
  unitCost: Cents;
  taxRate: number;
  lineTotal: Cents;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: { id: string; name: string; email?: string; phone?: string } | string;
  status: string;
  items: PurchaseOrderLine[];
  subtotal: Cents;
  taxTotal: Cents;
  shippingCost: Cents;
  grandTotal: Cents;
  expectedDeliveryDate?: string;
  submittedAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  notes?: string;
  isFullyReceived?: boolean;
  createdAt: string;
}

export interface Member {
  id: string;
  userId: { id: string; name: string; email: string } | null;
  role: string;
  status: string;
  displayName?: string;
  joinedAt?: string;
  createdAt: string;
}
