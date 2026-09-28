import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ORDER_SOURCES, OrderType } from '../../core/enums';
import { ApiItem, InventoryItemFull, LineModifier, MenuCategory, MenuItem, Order, Table } from '../../core/models';
import { LabelPipe, MoneyPipe } from '../../core/pipes';
import { fromCents, toCents } from '../../core/format';
import { StaffDirectoryService } from '../../core/staff-directory.service';
import { ToastService } from '../../core/toast.service';
import { ModalComponent } from '../../shared/modal.component';

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
  imports: [NgFor, NgIf, NgClass, FormsModule, RouterLink, MoneyPipe, LabelPipe, ModalComponent],
  templateUrl: './pos.component.html',
  styleUrls: ['./pos.component.scss'],
})
export class PosComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  directory = inject(StaffDirectoryService);

  readonly loading = signal(true);
  readonly categories = signal<MenuCategory[]>([]);
  readonly items = signal<MenuItem[]>([]);
  readonly tables = signal<Table[]>([]);
  readonly invItems = signal<InventoryItemFull[]>([]);
  /** When set, the cart is added to this existing order instead of creating a new one. */
  readonly existingOrder = signal<Order | null>(null);

  readonly activeCategory = signal<string>('all');
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

  readonly sources = ORDER_SOURCES;
  readonly fromCents = fromCents;
  readonly orderTypes: { value: OrderType; label: string; icon: string }[] = [
    { value: 'dine_in', label: 'Dine in', icon: 'bi-cup-hot' },
    { value: 'takeaway', label: 'Takeaway', icon: 'bi-bag' },
    { value: 'delivery', label: 'Delivery', icon: 'bi-scooter' },
  ];

  readonly visibleItems = computed(() => {
    const cat = this.activeCategory();
    const q = this.search().trim().toLowerCase();
    return this.items().filter(
      (i) =>
        (cat === 'all' || i.categoryId === cat) &&
        (!q || i.name.toLowerCase().includes(q) || (i.sku ?? '').toLowerCase().includes(q))
    );
  });

  readonly freeTables = computed(() =>
    this.tables().filter((t) => t.isActive && !t.currentOrderId && (t.status === 'available' || t.status === 'reserved'))
  );

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

    if (orderId) {
      this.api.get<ApiItem<Order>>(`/orders/${orderId}`).subscribe({
        next: (res) => {
          if (['completed', 'cancelled'].includes(res.data.status)) {
            this.toast.error(`Order ${res.data.orderNumber} is ${res.data.status} and can't be changed.`);
            this.router.navigate(['/orders', orderId]);
            return;
          }
          this.existingOrder.set(res.data);
        },
        error: (err) => this.toast.apiError(err, 'Order not found'),
      });
    }
  }

  /** Picking a table selects its assigned waiter (still changeable). */
  onTableChange(tableId: string): void {
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

  /** Line discount in cents, never more than the line subtotal. */
  discountCents(line: CartLine): number {
    return Math.max(0, Math.min(toCents(line.discount), this.lineGross(line)));
  }

  remove(line: CartLine): void {
    this.cart.update((lines) => lines.filter((l) => l.key !== line.key));
  }

  clear(): void {
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
      this.cart.set([]);
      await this.router.navigate(['/orders', order.id]);
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
