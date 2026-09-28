import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ORDER_SOURCES, OrderType } from '../../core/enums';
import { ApiItem, ApiList, InventoryItemFull,LineModifier, MenuCategory, MenuItem, Order, OrderItem, Table } from '../../core/models';
import { LabelPipe, MoneyPipe } from '../../core/pipes';
import { fromCents, toCents } from '../../core/format';
import { StaffDirectoryService } from '../../core/staff-directory.service';
import { ToastService } from '../../core/toast.service';
import { ModalComponent } from '../../shared/modal.component';
import { ConfirmService } from '../../core/confirm.service';
import { PaymentDialogComponent } from '../orders/payment-dialog.component';

interface CartLine {
  key: number;
  item: MenuItem;
  quantity: number;
  notes: string;
  showNotes: boolean;
  /** Discount on the whole line, in currency (sent as cents). */
  discount: number | null;
  showDiscount: boolean;
  /** Per-line ingredient customizations from the "Customize" popup. The menu recipe is untouched. */
  modifiers: LineModifier[];
}

/** One row in the "Adjust ingredients" list of the customize popup — a recipe ingredient the
 *  staff can dial up or down for this line only. `desiredQty` defaults to `baseQty` (no change);
 *  below it means less (0 = none), above it means extra, same units as the menu recipe. */
interface RecipeAdjust {
  inventoryItemId: string;
  name: string;
  unit: string;
  baseQty: number;
  desiredQty: number;
}

/** One row in the "Add extra" list of the customize popup. */
interface ExtraRow {
  inventoryItemId: string;
  quantity: number | null;
  priceDelta: number | null; // cents
}

const DIETARY_ICONS: Record<string, string> = {
  vegetarian: 'bi-flower1',
  vegan: 'bi-tree',
  spicy: 'bi-fire',
  halal: 'bi-patch-check',
  gluten_free: 'bi-slash-circle',
};

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, FormsModule, RouterLink, MoneyPipe, LabelPipe, ModalComponent, PaymentDialogComponent],
  templateUrl: './pos.component.html',
  styleUrls: ['./pos.component.scss'],
})
export class PosComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirm = inject(ConfirmService);
  directory = inject(StaffDirectoryService);

  readonly defaultOrderWidth = 400;
  /** Width of the order panel in px; the user can drag its left edge and the choice is remembered. */
  readonly orderWidth = signal(this.readOrderWidth());

  private readOrderWidth(): number {
    try {
      const n = Number(localStorage.getItem('pos.orderWidth'));
      return n >= 300 && n <= 700 ? n : 400;
    } catch {
      return 400;
    }
  }

  saveOrderWidth(): void {
    try {
      localStorage.setItem('pos.orderWidth', String(this.orderWidth()));
    } catch {
      /* storage unavailable: width just isn't remembered */
    }
  }

  startResize(ev: PointerEvent): void {
    ev.preventDefault();
    const startX = ev.clientX;
    const startW = this.orderWidth();
    const move = (e: PointerEvent) => this.orderWidth.set(Math.max(300, Math.min(700, Math.round(startW + (startX - e.clientX)))));
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this.saveOrderWidth();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  showPayment = false;
  completing = false;
  changingWaiter = false;

  readonly loading = signal(true);
  readonly categories = signal<MenuCategory[]>([]);
  readonly items = signal<MenuItem[]>([]);
  readonly tables = signal<Table[]>([]);
  readonly invItems = signal<InventoryItemFull[]>([]);
  /** When set, the cart is added to this existing order instead of creating a new one. */
  readonly existingOrder = signal<Order | null>(null);

  /** Categories currently shown; empty means "All". Several can be picked at once. */
  readonly selectedCategories = signal<string[]>([]);

  toggleCategory(id: string): void {
    this.selectedCategories.update((list) => (list.includes(id) ? list.filter((c) => c !== id) : [...list, id]));
  }
  readonly search = signal('');
  readonly cart = signal<CartLine[]>([]);
  private nextKey = 1;

  orderType: OrderType = 'dine_in';
  tableId = '';
  guestCount = 2;
  customerName = '';
  customerPhone = '';
  customerEmail = '';
  source = 'pos';
  /** Waiter serving the new order. Defaults to the table's assigned waiter, else the signed-in user. */
  waiterId = '';
  addressLine1 = '';
  addressPostalCode = '';
  addressCity = '';
  deliveryNotes = '';
  orderNotes = '';
  submitting: 'save' | 'send' | null = null;

  readonly sources = ORDER_SOURCES.filter((s) => s !== 'qr');
  readonly fromCents = fromCents;
  readonly orderTypes: { value: OrderType; label: string; icon: string }[] = [
    { value: 'dine_in', label: 'Dine in', icon: 'bi-cup-hot' },
    { value: 'takeaway', label: 'Takeaway', icon: 'bi-bag' },
    { value: 'delivery', label: 'Delivery', icon: 'bi-scooter' },
  ];

  readonly visibleItems = computed(() => {
    const cats = this.selectedCategories();
    const q = this.search().trim().toLowerCase();
    return this.items().filter(
      (i) =>
        (!cats.length || cats.includes(i.categoryId)) &&
        (!q || i.name.toLowerCase().includes(q) || (i.sku ?? '').toLowerCase().includes(q))
    );
  });

  readonly freeTables = computed(() =>
    this.tables().filter((t) => t.isActive && !t.currentOrderId && (t.status === 'available' || t.status === 'reserved'))
  );

  readonly existingLines = computed(() => (this.existingOrder()?.items ?? []).filter((l) => l.status !== 'cancelled'));

  /** The whole bill: everything already on the running order plus what is in the cart. */
  readonly bill = computed(() => {
    const eo = this.existingOrder();
    const t = this.totals();
    return {
      items: (eo?.subtotal ?? 0) + t.subtotal,
      discount: (eo?.discountTotal ?? 0) + t.discount,
      tax: (eo?.taxTotal ?? 0) + t.tax,
      service: (eo?.serviceCharge ?? 0) + t.service,
      total: (eo?.grandTotal ?? 0) + t.total,
    };
  });

  /** Ids of open orders that still owe money; a fully paid order no longer counts as "running". */
  private readonly unpaidOrderIds = signal<Set<string>>(new Set());

  readonly runningTables = computed(() =>
    this.tables().filter((t) => t.isActive && !!t.currentOrderId && this.unpaidOrderIds().has(t.currentOrderId))
  );

  private loadRunningOrders(): void {
    forkJoin(['open', 'in_progress', 'ready', 'served'].map((status) => this.api.get<ApiList<Order>>('/orders', { status, limit: 100 }))).subscribe({
      next: (groups) =>
        this.unpaidOrderIds.set(new Set(groups.flatMap((g) => g.data).filter((o) => o.paymentStatus !== 'paid').map((o) => o.id))),
    });
  }

  private reloadTables(): void {
    this.api.getAll<Table>('/tables', { isActive: true }).subscribe((t) => this.tables.set(t));
    this.loadRunningOrders();
  }

  readonly itemCount = computed(() => this.cart().reduce((n, l) => n + l.quantity, 0));

  /**
   * Client-side estimate using the same formula as Order.recalculateTotals() on the server:
   * the line discount is capped at the line subtotal, tax is charged on the discounted amount,
   * and the service charge (dine-in only) applies to the pre-tax total.
   */
  readonly totals = computed(() => {
    const tax = this.auth.tenant()?.tax;
    const defaultRate = tax?.rate ?? 0;
    const inclusive = tax?.pricesIncludeTax ?? false;
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let linesTotal = 0;
    for (const line of this.cart()) {
      const lineSubtotal = this.lineGross(line);
      const discount = Math.min(this.discountCents(line), lineSubtotal);
      const net = lineSubtotal - discount;
      const rate = line.item.taxRate ?? defaultRate;
      const lineTax = inclusive ? net - Math.round(net / (1 + rate / 100)) : Math.round((net * rate) / 100);
      subtotal += lineSubtotal;
      discountTotal += discount;
      taxTotal += lineTax;
      linesTotal += inclusive ? net : net + lineTax;
    }
    const type = this.existingOrder()?.type ?? this.orderType;
    const rate = type === 'dine_in' ? tax?.serviceChargeRate ?? 0 : 0;
    const service = Math.round(((linesTotal - taxTotal) * rate) / 100);
    return { subtotal, discount: discountTotal, tax: taxTotal, service, total: linesTotal + service };
  });

  ngOnInit(): void {
    this.directory.load();
    this.waiterId = this.auth.user()?.id ?? '';
    const orderId = this.route.snapshot.queryParamMap.get('orderId');
    const tableId = this.route.snapshot.queryParamMap.get('tableId');

    forkJoin({
      categories: this.api.getAll<MenuCategory>('/menu/categories', { isActive: true }),
      items: this.api.getAll<MenuItem>('/menu/items', { isActive: true }),
      tables: this.api.getAll<Table>('/tables', { isActive: true }),
      invItems: this.api.getAll<InventoryItemFull>('/inventory/items', { isActive: true }),
    }).subscribe({
      next: ({ categories, items, tables, invItems }) => {
        this.categories.set(categories);
        this.items.set(items);
        this.tables.set(tables);
        this.loadRunningOrders();
        this.invItems.set(invItems);
        if (tableId && this.freeTables().some((t) => t.id === tableId)) {
          this.orderType = 'dine_in';
          this.onTableChange(tableId);
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err, 'Could not load the menu');
        this.loading.set(false);
      },
    });

    if (orderId) this.loadExisting(orderId, true);
  }

  private loadExisting(orderId: string, leaveIfClosed: boolean): void {
    this.api.get<ApiItem<Order>>(`/orders/${orderId}`).subscribe({
      next: (res) => {
        if (['completed', 'cancelled'].includes(res.data.status)) {
          this.toast.error(`Order ${res.data.orderNumber} is ${res.data.status} and can't be changed.`);
          if (leaveIfClosed) this.router.navigate(['/orders', orderId]);
          else this.tableId = '';
          return;
        }
        this.existingOrder.set(res.data);
        this.orderDiscount.set(null);
        this.discountDraft =res.data.orderDiscount ? fromCents(res.data.orderDiscount) : null;
      },
      error: (err) => {
        this.toast.apiError(err, 'Order not found');
        this.tableId = '';
      },
    });
  }

  canTill(): boolean {
    return this.auth.hasRole('manager', 'cashier');
  }

  cancellingLine: string | null = null;

  async cancelExistingLine(line: OrderItem): Promise<void> {
    const eo = this.existingOrder();
    if (!eo) return;
    const result = await this.confirm.ask({
      title: `Cancel ${line.quantity} × ${line.name}?`,
      message: 'The line will be removed from the bill.',
      confirmText: 'Cancel item',
      tone: 'danger',
      reason: { label: 'Reason', placeholder: 'e.g. Customer changed mind' },
      checkbox: {
        label: 'Return ingredients to stock',
        hint: 'Untick if the dish was already made and thrown away.',
        checked: line.status === 'pending' || line.status === 'sent',
      },
    });
    if (!result) return;
    this.cancellingLine = line.id;
    try {
      await firstValueFrom(
        this.api.post(`/orders/${eo.id}/items/${line.id}/cancel`, { reason: result.reason || undefined, returnToStock: result.checked })
      );
      this.toast.success(`${line.name} cancelled`);
      this.loadExisting(eo.id, false);
    } catch (err) {
      this.toast.apiError(err);
    } finally {
      this.cancellingLine = null;
    }
  }

  async changeWaiter(waiterId: string): Promise<void> {
    const eo = this.existingOrder();
    if (!eo || !waiterId || waiterId === this.directory.waiterOf(eo)) return;
    this.changingWaiter = true;
    try {
      await firstValueFrom(this.api.patch(`/orders/${eo.id}/waiter`, { waiterId }));
      this.toast.success(`Waiter changed to ${this.directory.name(waiterId)}`);
      this.loadExisting(eo.id, false);
    } catch (err) {
      this.toast.apiError(err);
    } finally {
      this.changingWaiter = false;
    }
  }

  /** Discount typed for the running order (currency); applied to the whole order on the server. */
  discountDraft: number | null = null;
  applyingDiscount = false;

  discountChanged(): boolean {
    const eo = this.existingOrder();
    return !!eo && toCents(this.discountDraft) !== (eo.orderDiscount ?? 0);
  }

  async applyOrderDiscount(): Promise<void> {
    const eo = this.existingOrder();
    if (!eo || !this.discountChanged()) return;
    // The server refuses a discount above the order total, so cap it here instead of failing.
    const room = Math.max(0, eo.subtotal - (eo.discountTotal - (eo.orderDiscount ?? 0)));
    const wanted = toCents(this.discountDraft);
    const amount = Math.min(wanted, room);
    if (amount < wanted) {
      this.discountDraft = fromCents(amount);
      this.toast.info(`Discount limited to the order total (${(this.discountDraft ?? 0).toFixed(2)})`);
    }
    if (amount === (eo.orderDiscount ?? 0)) return;
    this.applyingDiscount = true;
    try {
      await firstValueFrom(this.api.patch(`/orders/${eo.id}/discount`, { amount }));
      this.toast.success(amount ? 'Discount applied' : 'Discount removed');
      this.loadExisting(eo.id, false);
    } catch (err) {
      this.toast.apiError(err);
    } finally {
      this.applyingDiscount = false;
    }
  }

  async onPaid(order: Order): Promise<void> {
    this.showPayment = false;
    this.toast.success('Payment recorded');
    if ((order.balanceDue ?? 0) > 0) {
      this.loadExisting(order.id, false);
      this.loadRunningOrders();
      return;
    }
    // Fully paid: close the order so its table is free for the next guests.
    try {
      if (order.items.some((i) => i.status === 'pending')) await firstValueFrom(this.api.post(`/orders/${order.id}/send`));
      await firstValueFrom(this.api.post<ApiItem<Order>>(`/orders/${order.id}/complete`));
      this.toast.success(`${order.orderNumber} paid and closed`, 'The table is ready for a new order.');
      this.startNewOrder();
      this.reloadTables();
    } catch (err) {
      this.toast.apiError(err);
      this.loadExisting(order.id, false);
    }
  }

  async completeOrder(): Promise<void> {
    const eo = this.existingOrder();
    if (!eo) return;
    const result = await this.confirm.ask({
      title: 'Close this order?',
      message: 'The bill is fully paid. Completing it closes the ticket and frees the table.',
      confirmText: 'Complete order',
    });
    if (!result) return;
    this.completing = true;
    try {
      const res = await firstValueFrom(this.api.post<ApiItem<Order>>(`/orders/${eo.id}/complete`));
      this.toast.success(`${res.data.orderNumber} completed`);
      this.startNewOrder();
      this.reloadTables();
    } catch (err) {
      this.toast.apiError(err);
    } finally {
      this.completing = false;
    }
  }

  /** Back from a running order to a brand-new one (the cart is kept). */
  startNewOrder(): void {
    this.existingOrder.set(null);
    this.tableId = '';
  }

  /** Picking a table selects its assigned waiter (still changeable); a table with a running order opens that order. */
  onTableChange(tableId: string): void {
    const running = this.tables().find((t) => t.id === tableId)?.currentOrderId;
    if (running) {
      this.tableId = tableId;
      this.loadExisting(running, false);
      return;
    }
    this.tableId = tableId;
    const assigned = this.tables().find((t) => t.id === tableId)?.assignedWaiterId;
    if (assigned) this.waiterId = assigned;
  }

  tableWaiterName(t: Table): string {
    return t.assignedWaiterId ? ` · ${this.directory.name(t.assignedWaiterId)}` : '';
  }

  categoryName(id: string): string {
    return this.categories().find((c) => c.id === id)?.name ?? '';
  }

  countInCategory(id: string): number {
    return id === 'all' ? this.items().length : this.items().filter((i) => i.categoryId === id).length;
  }

  qtyInCart(item: MenuItem): number {
    return this.cart()
      .filter((l) => l.item.id === item.id)
      .reduce((n, l) => n + l.quantity, 0);
  }

  dietaryIcon(tag: string): string | null {
    return DIETARY_ICONS[tag] ?? null;
  }

  add(item: MenuItem): void {
    if (!item.isAvailable) return;
    this.cart.update((lines) => {
      // Merge with an existing line only if it has no special notes, discount or customization.
      const existing = lines.find((l) => l.item.id === item.id && !l.notes && !l.discount && !l.modifiers.length);
      if (existing) return lines.map((l) => (l === existing ? { ...l, quantity: Math.min(l.quantity + 1, 999) } : l));
      return [...lines, { key: this.nextKey++, item, quantity: 1, notes: '', showNotes: false, discount: null, showDiscount: false, modifiers: [] }];
    });
  }

  /** Menu items worth offering "Customize" on: they have a recipe with something to adjust. */
  canCustomize(item: MenuItem): boolean {
    return item.recipe.length > 0;
  }

  changeQty(line: CartLine, delta: number): void {
    const quantity = line.quantity + delta;
    if (quantity < 1) {
      this.remove(line);
      return;
    }
    this.cart.update((lines) => lines.map((l) => (l.key === line.key ? { ...l, quantity: Math.min(quantity, 999) } : l)));
  }

  setNotes(line: CartLine, notes: string): void {
    this.cart.update((lines) => lines.map((l) => (l.key === line.key ? { ...l, notes } : l)));
  }

  toggleNotes(line: CartLine): void {
    this.cart.update((lines) => lines.map((l) => (l.key === line.key ? { ...l, showNotes: !l.showNotes } : l)));
  }

  setDiscount(line: CartLine, discount: number | null): void {
    this.cart.update((lines) => lines.map((l) => (l.key === line.key ? { ...l, discount } : l)));
  }

  toggleDiscount(line: CartLine): void {
    this.cart.update((lines) => lines.map((l) => (l.key === line.key ? { ...l, showDiscount: !l.showDiscount } : l)));
  }

  /** Sum of a line's modifier price deltas, per portion (e.g. "+2 egg" = +100 cents). */
  modifierDelta(line: CartLine): number {
    return line.modifiers.reduce((sum, m) => sum + (m.priceDelta || 0), 0);
  }

  /** Line subtotal before discount: (menu price + modifiers) × quantity. Mirrors the server. */
  lineGross(line: CartLine): number {
    return (line.item.price + this.modifierDelta(line)) * line.quantity;
  }

  private ownDiscount(line: CartLine): number {
    return Math.max(0, Math.min(toCents(line.discount), this.lineGross(line)));
  }

  /** Whole-order discount (currency) typed in the totals; spread over the new lines by value when sending. */
  readonly orderDiscount = signal<number | null>(null);

  private readonly orderShares = computed(() => {
    const lines = this.cart();
    const bases = lines.map((l) => this.lineGross(l) - this.ownDiscount(l));
    const total = bases.reduce((s, b) => s + b, 0);
    const wanted = Math.max(0, Math.min(toCents(this.orderDiscount()), total));
    const shares = new Map<number, number>();
    if (!wanted || !total) return shares;
    let given = 0;
    let last = -1;
    lines.forEach((l, i) => {
      if (bases[i] > 0) last = i;
    });
    lines.forEach((l, i) => {
      const share = i === last ? wanted - given : Math.floor((wanted * bases[i]) / total);
      shares.set(l.key, share);
      given += share;
    });
    return shares;
  });

  /** Line discount in cents (own discount plus its share of the order discount), never more than the line subtotal. */
  discountCents(line: CartLine): number {
    return Math.min(this.ownDiscount(line) + (this.orderShares().get(line.key) ?? 0), this.lineGross(line));
  }

  remove(line: CartLine): void {
    this.cart.update((lines) => lines.filter((l) => l.key !== line.key));
  }

  clear(): void {
    this.orderDiscount.set(null);
    this.cart.set([]);
  }

  lineTotal(line: CartLine): number {
    return this.lineGross(line) - this.discountCents(line);
  }

  /** "+2 g Egg" or "−10 g Lettuce" — always shows the actual amount, whether that's a partial
   *  adjustment or happens to be the ingredient's full recipe quantity (i.e. "none"). */
  modifierSummary(line: CartLine): string {
    return line.modifiers.map((m) => this.modifierLabel(m)).join(', ');
  }

  modifierLabel(m: LineModifier): string {
    const sign = m.action === 'remove' ? '−' : '+';
    return `${sign}${this.fq(m.quantity)} ${m.unit ?? ''} ${m.name}`.replace(/\s+/g, ' ').trim();
  }

  fq(n: number): string {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  // ---- Customize popup ("+2 egg", "less lettuce" — per line only, menu recipe untouched) -----------
  customizeItem: MenuItem | null = null;
  /** Every recipe ingredient, each individually adjustable up or down from its recipe amount. */
  customizeRecipe: RecipeAdjust[] = [];
  /** Ingredients NOT in the recipe, added fresh with their own quantity and optional price. */
  customizeExtras: ExtraRow[] = [];
  customizeQty = 1;
  private customizeEditingKey: number | null = null;

  openCustomize(item: MenuItem): void {
    if (!item.isAvailable) return;
    this.customizeItem = item;
    this.customizeEditingKey = null;
    this.customizeQty = 1;
    this.customizeRecipe = item.recipe.map((r) => ({
      inventoryItemId: r.inventoryItemId,
      name: this.invName(r.inventoryItemId),
      unit: r.unit ?? this.invUnit(r.inventoryItemId),
      baseQty: r.quantity,
      desiredQty: r.quantity,
    }));
    this.customizeExtras = [];
  }

  /** Re-open the popup to edit a line already in the cart, restoring its adjustments. */
  editCustomize(line: CartLine): void {
    this.openCustomize(line.item);
    this.customizeEditingKey = line.key;
    this.customizeQty = line.quantity;
    for (const m of line.modifiers) {
      const row = this.customizeRecipe.find((r) => r.inventoryItemId === m.inventoryItemId);
      if (!row) continue; // an 'add' for something not in the recipe — handled as an extra below
      row.desiredQty = m.action === 'remove' ? Math.max(0, row.baseQty - m.quantity) : row.baseQty + m.quantity;
    }
    const recipeIds = new Set(this.customizeRecipe.map((r) => r.inventoryItemId));
    this.customizeExtras = line.modifiers
      .filter((m) => m.action === 'add' && !recipeIds.has(m.inventoryItemId))
      .map((m) => ({ inventoryItemId: m.inventoryItemId, quantity: m.quantity, priceDelta: m.priceDelta }));
  }

  closeCustomize(): void {
    this.customizeItem = null;
  }

  resetRow(r: RecipeAdjust): void {
    r.desiredQty = r.baseQty;
  }

  removeRow(r: RecipeAdjust): void {
    r.desiredQty = 0;
  }

  addExtraRow(): void {
    this.customizeExtras = [...this.customizeExtras, { inventoryItemId: '', quantity: 1, priceDelta: 0 }];
  }

  removeExtraRow(i: number): void {
    this.customizeExtras = this.customizeExtras.filter((_, idx) => idx !== i);
  }

  invUnit(id: string): string {
    return this.invItems().find((i) => i.id === id)?.unit ?? '';
  }

  invName(id: string): string {
    return this.invItems().find((i) => i.id === id)?.name ?? 'Unknown ingredient';
  }

  /** Ingredients not already in the recipe (those are adjusted in place above), for the add-extra picker. */
  extraChoices(): InventoryItemFull[] {
    const recipeIds = new Set(this.customizeRecipe.map((r) => r.inventoryItemId));
    return [...this.invItems()].filter((i) => !recipeIds.has(i.id)).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Extra charge per portion from the "Add extra" rows only (in-place recipe adjustments are free). Cents. */
  customizePriceDelta(): number {
    return this.customizeExtras.reduce((s, e) => s + (e.priceDelta || 0), 0);
  }

  setExtraPrice(e: ExtraRow, dollars: number | null): void {
    e.priceDelta = toCents(dollars);
  }

  customizeUnitPrice(): number {
    return (this.customizeItem?.price ?? 0) + this.customizePriceDelta();
  }

  incCustomizeQty(delta: number): void {
    this.customizeQty = Math.max(1, Math.min(999, this.customizeQty + delta));
  }

  addCustomizedToCart(): void {
    const item = this.customizeItem;
    if (!item) return;
    const modifiers: LineModifier[] = [];
    for (const r of this.customizeRecipe) {
      const desired = Math.max(0, Number(r.desiredQty) || 0);
      const delta = desired - r.baseQty;
      if (Math.abs(delta) < 1e-9) continue; // unchanged from the recipe
      if (delta < 0) modifiers.push({ inventoryItemId: r.inventoryItemId, name: r.name, unit: r.unit, action: 'remove', quantity: -delta, priceDelta: 0 });
      else modifiers.push({ inventoryItemId: r.inventoryItemId, name: r.name, unit: r.unit, action: 'add', quantity: delta, priceDelta: 0 });
    }
    for (const e of this.customizeExtras) {
      if (!e.inventoryItemId || !(Number(e.quantity) > 0)) continue;
      modifiers.push({
        inventoryItemId: e.inventoryItemId,
        name: this.invName(e.inventoryItemId),
        unit: this.invUnit(e.inventoryItemId),
        action: 'add',
        quantity: Number(e.quantity),
        priceDelta: Math.round(Number(e.priceDelta) || 0),
      });
    }

    const editingKey = this.customizeEditingKey;
    this.cart.update((lines) => {
      if (editingKey !== null) {
        return lines.map((l) => (l.key === editingKey ? { ...l, quantity: this.customizeQty, modifiers } : l));
      }
      return [
        ...lines,
        { key: this.nextKey++, item, quantity: this.customizeQty, notes: '', showNotes: false, discount: null, showDiscount: false, modifiers },
      ];
    });
    this.closeCustomize();
  }

  async submit(sendToKitchen: boolean): Promise<void> {
    if (!this.cart().length || this.submitting) return;
    this.submitting = sendToKitchen ? 'send' : 'save';
    const items = this.cart().map((l) => ({
      menuItemId: l.item.id,
      quantity: l.quantity,
      ...(l.notes.trim() && { notes: l.notes.trim() }),
      ...(this.discountCents(l) > 0 && { discountAmount: this.discountCents(l) }),
      ...(l.modifiers.length && {
        modifiers: l.modifiers.map((m) => ({
          inventoryItemId: m.inventoryItemId,
          action: m.action,
          quantity: m.quantity,
          priceDelta: m.priceDelta,
        })),
      }),
    }));

    try {
      let order: Order;
      const existing = this.existingOrder();
      if (existing) {
        order = (await firstValueFrom(this.api.post<ApiItem<Order>>(`/orders/${existing.id}/items`, { items }))).data;
      } else {
        order = (await firstValueFrom(this.api.post<ApiItem<Order>>('/orders', this.buildOrderBody(items)))).data;
      }

      if (sendToKitchen) {
        try {
          order = (await firstValueFrom(this.api.post<ApiItem<Order>>(`/orders/${order.id}/send`))).data;
          this.toast.success(`${order.orderNumber} sent to the kitchen`);
        } catch (err) {
          // The order is saved; only firing failed (e.g. insufficient stock).
          this.toast.apiError(err, 'Order saved, but it could not be sent to the kitchen');
        }
      } else {
        this.toast.success(existing ? `Items added to ${order.orderNumber}` : `${order.orderNumber} saved`);
      }
      this.orderDiscount.set(null);
      this.cart.set([]);
      // Stay on the POS: the order (new or existing) now shows as the running order with its items.
      this.loadExisting(order.id, false);
      this.reloadTables();
    } catch (err) {
      this.toast.apiError(err, 'Could not save the order');
    } finally {
      this.submitting = null;
    }
  }

  private buildOrderBody(items: { menuItemId: string; quantity: number; notes?: string }[]): Record<string, unknown> {
    const body: Record<string, unknown> = { type: this.orderType, source: this.source, items };
    if (this.waiterId) body['waiterId'] = this.waiterId;
    if (this.orderNotes.trim()) body['notes'] = this.orderNotes.trim();
    if (this.orderType === 'dine_in') {
      if (this.tableId) body['tableId'] = this.tableId;
      body['guestCount'] = Math.max(1, Math.min(500, Math.round(this.guestCount || 1)));
    } else {
      const customer: Record<string, unknown> = {};
      if (this.customerName.trim()) customer['name'] = this.customerName.trim();
      if (this.customerPhone.trim()) customer['phone'] = this.customerPhone.trim();
      if (this.customerEmail.trim()) customer['email'] = this.customerEmail.trim();
      if (this.orderType === 'delivery') {
        if (this.addressLine1.trim() || this.addressCity.trim() || this.addressPostalCode.trim()) {
          customer['address'] = {
            line1: this.addressLine1.trim(),
            city: this.addressCity.trim(),
            postalCode: this.addressPostalCode.trim(),
          };
        }
        if (this.deliveryNotes.trim()) customer['deliveryNotes'] = this.deliveryNotes.trim();
      }
      if (Object.keys(customer).length) body['customer'] = customer;
    }
    return body;
  }

  existingTableName(): string {
    const t = this.existingOrder()?.tableId;
    return t && typeof t === 'object' ? t.name : '';
  }

  trackByKey(_: number, line: CartLine): number {
    return line.key;
  }

  trackById(_: number, row: { id: string }): string {
    return row.id;
  }
}
