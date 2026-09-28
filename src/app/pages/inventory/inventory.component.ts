import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { STOCK_MOVEMENT_TYPES, UNITS } from '../../core/enums';
import { formatQty, fromCents } from '../../core/format';
import { ApiError, ApiItem, ApiList, InventoryCategory, InventoryItemFull, StockMovement, Supplier } from '../../core/models';
import { LabelPipe, MoneyPipe, TzDatePipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';
import { ModalComponent } from '../../shared/modal.component';

/** Movement types a person may record by hand (backend MANUAL_MOVEMENT_TYPES). */
const MANUAL_TYPES = ['waste', 'adjustment', 'opening_balance', 'transfer_in', 'transfer_out', 'return_to_supplier'] as const;
type ManualType = (typeof MANUAL_TYPES)[number];
const INBOUND = ['purchase_receipt', 'sale_reversal', 'transfer_in', 'opening_balance'];
const OUTBOUND = ['sale_deduction', 'waste', 'transfer_out', 'return_to_supplier'];

interface ItemForm {
  name: string;
  sku: string;
  barcode: string;
  description: string;
  categoryId: string;
  unit: string;
  purchaseUnitName: string;
  purchaseUnitFactor: number | null;
  reorderLevel: number | null;
  reorderQuantity: number | null;
  parLevel: number | null;
  preferredSupplierId: string;
  storageLocation: string;
  isPerishable: boolean;
  shelfLifeDays: number | null;
  isActive: boolean;
}

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, MoneyPipe, LabelPipe, TzDatePipe, ModalComponent],
  templateUrl: './inventory.component.html',
  styleUrls: ['./inventory.component.scss'],
})
export class InventoryComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  readonly tab = signal<'items' | 'categories'>('items');
  readonly loading = signal(true);
  readonly items = signal<InventoryItemFull[]>([]);
  readonly categories = signal<InventoryCategory[]>([]);
  readonly suppliers = signal<Supplier[]>([]);

  readonly search = signal('');
  readonly categoryFilter = signal('');
  readonly stockFilter = signal<'all' | 'low' | 'inactive'>('all');

  // Role checks mirror inventory.routes.js
  readonly canEditItems = computed(() => this.auth.hasRole('manager', 'inventory_clerk'));
  readonly canMoveStock = computed(() => this.auth.hasRole('manager', 'inventory_clerk', 'chef'));
  readonly canReconcile = computed(() => this.auth.hasRole('manager'));

  readonly units = UNITS;
  readonly manualTypes = MANUAL_TYPES;
  readonly movementTypes = STOCK_MOVEMENT_TYPES;
  readonly formatQty = formatQty;

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.categoryFilter();
    const f = this.stockFilter();
    return this.items().filter((i) => {
      if (cat && i.categoryId !== cat) return false;
      if (f === 'low' && !(i.isActive && i.currentStock <= i.reorderLevel)) return false;
      if (f === 'inactive' && i.isActive) return false;
      if (f !== 'inactive' && !i.isActive && f !== 'all') return false;
      return !q || i.name.toLowerCase().includes(q) || (i.sku ?? '').toLowerCase().includes(q);
    });
  });

  readonly totals = computed(() => {
    const active = this.items().filter((i) => i.isActive);
    return {
      count: active.length,
      value: active.reduce((sum, i) => sum + (i.stockValue ?? 0), 0),
      low: active.filter((i) => i.currentStock <= i.reorderLevel).length,
    };
  });

  // Item form
  showItemForm = false;
  editingItem: InventoryItemFull | null = null;
  itemForm: ItemForm = this.blankItem();
  itemError: string | null = null;
  saving = false;

  // Adjustment
  adjustItem: InventoryItemFull | null = null;
  adjustType: ManualType = 'waste';
  adjustQty: number | null = null;
  adjustReason = '';
  adjustUnitCost: number | null = null;
  adjustError: string | null = null;

  // Count
  countItem: InventoryItemFull | null = null;
  countQty: number | null = null;
  countReason = '';
  countError: string | null = null;

  // Movements
  movementsItem: InventoryItemFull | null = null;
  movements: StockMovement[] = [];
  movementsLoading = false;
  movementType = '';
  movementPage = 1;
  readonly movementLimit = 50;

  // Category form
  showCategoryForm = false;
  editingCategory: InventoryCategory | null = null;
  categoryForm = { name: '', description: '', parentId: '', sortOrder: 0 };
  categoryError: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({
      items: this.api.getAll<InventoryItemFull>('/inventory/items'),
      categories: this.api.getAll<InventoryCategory>('/inventory/categories'),
      suppliers: this.api.getAll<Supplier>('/suppliers'),
    }).subscribe({
      next: ({ items, categories, suppliers }) => {
        this.items.set(items);
        this.categories.set(categories);
        this.suppliers.set(suppliers);
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err);
        this.loading.set(false);
      },
    });
  }

  categoryName(id?: string | null): string {
    return (id && this.categories().find((c) => c.id === id)?.name) || '—';
  }

  supplierName(id?: string | null): string {
    return (id && this.suppliers().find((s) => s.id === id)?.name) || '';
  }

  itemsInCategory(id: string): number {
    return this.items().filter((i) => i.categoryId === id).length;
  }

  stockPct(i: InventoryItemFull): number {
    const target = Math.max(i.parLevel || 0, i.reorderLevel * 2, 1);
    return Math.max(0, Math.min(100, (i.currentStock / target) * 100));
  }

  isLow(i: InventoryItemFull): boolean {
    return i.isActive && i.currentStock <= i.reorderLevel;
  }

  // ---- Item CRUD --------------------------------------------------------------------
  newItem(): void {
    this.editingItem = null;
    this.itemForm = this.blankItem();
    this.itemForm.categoryId = this.categoryFilter();
    this.itemError = null;
    this.showItemForm = true;
  }

  editItem(i: InventoryItemFull): void {
    this.editingItem = i;
    this.itemForm = {
      name: i.name,
      sku: i.sku ?? '',
      barcode: i.barcode ?? '',
      description: i.description ?? '',
      categoryId: i.categoryId ?? '',
      unit: i.unit,
      purchaseUnitName: i.purchaseUnit?.name ?? '',
      purchaseUnitFactor: i.purchaseUnit?.factor ?? 1,
      reorderLevel: i.reorderLevel ?? 0,
      reorderQuantity: i.reorderQuantity ?? 0,
      parLevel: i.parLevel ?? 0,
      preferredSupplierId: i.preferredSupplierId ?? '',
      storageLocation: i.storageLocation ?? '',
      isPerishable: !!i.isPerishable,
      shelfLifeDays: i.shelfLifeDays ?? null,
      isActive: i.isActive,
    };
    this.itemError = null;
    this.showItemForm = true;
  }

  saveItem(): void {
    const f = this.itemForm;
    if (!f.name.trim() || !f.unit) {
      this.itemError = 'Name and unit are required.';
      return;
    }
    if (f.purchaseUnitFactor !== null && !(f.purchaseUnitFactor > 0)) {
      this.itemError = 'Units per purchase unit must be above 0.';
      return;
    }
    const body: Record<string, unknown> = {
      name: f.name.trim(),
      sku: f.sku.trim(),
      barcode: f.barcode.trim(),
      description: f.description.trim(),
      categoryId: f.categoryId || null,
      unit: f.unit,
      purchaseUnit: { name: f.purchaseUnitName.trim() || undefined, factor: Number(f.purchaseUnitFactor) || 1 },
      reorderLevel: Number(f.reorderLevel) || 0,
      reorderQuantity: Number(f.reorderQuantity) || 0,
      parLevel: Number(f.parLevel) || 0,
      preferredSupplierId: f.preferredSupplierId || null,
      storageLocation: f.storageLocation.trim(),
      isPerishable: f.isPerishable,
      isActive: f.isActive,
    };
    if (f.isPerishable && f.shelfLifeDays !== null) body['shelfLifeDays'] = Number(f.shelfLifeDays);

    this.saving = true;
    this.itemError = null;
    const req = this.editingItem ? this.api.patch(`/inventory/items/${this.editingItem.id}`, body) : this.api.post('/inventory/items', body);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showItemForm = false;
        this.toast.success(
          this.editingItem ? `${body['name']} updated` : `${body['name']} created`,
          this.editingItem ? undefined : 'Record an opening balance to put it in stock.'
        );
        this.load();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.itemError = err.message;
      },
    });
  }

  async deleteItem(i: InventoryItemFull): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete ${i.name}?`,
      message: 'It will disappear from inventory lists. Recipes that use it should be updated.',
      confirmText: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.delete(`/inventory/items/${i.id}`).subscribe({
      next: () => {
        this.toast.success(`${i.name} deleted`);
        this.load();
      },
      error: (err) => this.toast.apiError(err),
    });
  }

  // ---- Stock adjustment ---------------------------------------------------------------
  openAdjust(i: InventoryItemFull, type: ManualType = 'waste'): void {
    this.adjustItem = i;
    this.adjustType = type;
    this.adjustQty = null;
    this.adjustReason = '';
    this.adjustUnitCost = null;
    this.adjustError = null;
  }

  /** How the entered quantity affects stock for the chosen type. */
  adjustDirection(): 'in' | 'out' | 'either' {
    if (INBOUND.includes(this.adjustType)) return 'in';
    if (OUTBOUND.includes(this.adjustType)) return 'out';
    return 'either';
  }

  projectedStock(): number {
    if (!this.adjustItem || !this.adjustQty) return this.adjustItem?.currentStock ?? 0;
    const q = Number(this.adjustQty);
    const signed = this.adjustDirection() === 'in' ? Math.abs(q) : this.adjustDirection() === 'out' ? -Math.abs(q) : q;
    return this.adjustItem.currentStock + signed;
  }

  saveAdjust(): void {
    if (!this.adjustItem) return;
    const qty = Number(this.adjustQty);
    if (!Number.isFinite(qty) || qty === 0) {
      this.adjustError = 'Enter a quantity other than 0.';
      return;
    }
    const body: Record<string, unknown> = { type: this.adjustType, quantity: qty, reason: this.adjustReason.trim() || undefined };
    // Unit cost is per base unit in minor units; the user types it in currency.
    if (this.adjustType === 'opening_balance' && this.adjustUnitCost !== null) {
      body['unitCost'] = Math.round(Number(this.adjustUnitCost) * 100 * 10000) / 10000;
    }
    this.saving = true;
    this.api.post(`/inventory/items/${this.adjustItem.id}/adjustments`, body).subscribe({
      next: () => {
        this.saving = false;
        this.toast.success(`${this.adjustItem?.name}: ${this.adjustType.replace(/_/g, ' ')} recorded`);
        this.adjustItem = null;
        this.load();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.adjustError = this.shortageMessage(err);
      },
    });
  }

  // ---- Stock count --------------------------------------------------------------------
  openCount(i: InventoryItemFull): void {
    this.countItem = i;
    this.countQty = i.currentStock;
    this.countReason = '';
    this.countError = null;
  }

  countVariance(): number {
    return this.countItem ? Number(this.countQty ?? 0) - this.countItem.currentStock : 0;
  }

  saveCount(): void {
    if (!this.countItem) return;
    const counted = Number(this.countQty);
    if (!Number.isFinite(counted) || counted < 0) {
      this.countError = 'Counted quantity must be 0 or more.';
      return;
    }
    this.saving = true;
    const body: Record<string, unknown> = { countedQuantity: counted };
    if (this.countReason.trim()) body['reason'] = this.countReason.trim();
    this.api.post<ApiItem<{ variance: number }>>(`/inventory/items/${this.countItem.id}/counts`, body).subscribe({
      next: (res) => {
        this.saving = false;
        const v = res.data.variance;
        this.toast.success(
          'Stock count saved',
          v === 0 ? 'No variance. Stock matched the system.' : `Variance ${v > 0 ? '+' : ''}${formatQty(v)} ${this.countItem?.unit}`
        );
        this.countItem = null;
        this.load();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.countError = err.message;
      },
    });
  }

  // ---- Movements & reconcile -------------------------------------------------------------
  openMovements(i: InventoryItemFull): void {
    this.movementsItem = i;
    this.movementType = '';
    this.movementPage = 1;
    this.loadMovements();
  }

  loadMovements(): void {
    if (!this.movementsItem) return;
    this.movementsLoading = true;
    this.api
      .get<ApiList<StockMovement>>(`/inventory/items/${this.movementsItem.id}/movements`, {
        type: this.movementType,
        page: this.movementPage,
        limit: this.movementLimit,
      })
      .subscribe({
        next: (res) => {
          this.movements = res.data;
          this.movementsLoading = false;
        },
        error: (err) => {
          this.movementsLoading = false;
          this.toast.apiError(err);
        },
      });
  }

  reconcile(i: InventoryItemFull): void {
    this.api
      .get<ApiItem<{ cachedBalance: number; ledgerBalance: number; movementCount: number; inSync: boolean }>>(
        `/inventory/items/${i.id}/reconcile`
      )
      .subscribe({
        next: (res) => {
          const d = res.data;
          if (d.inSync) {
            this.toast.success(`${i.name}: ledger matches stock`, `${formatQty(d.ledgerBalance)} ${i.unit} across ${d.movementCount} movements`);
          } else {
            this.toast.error(`${i.name}: ledger mismatch`, `Stock ${formatQty(d.cachedBalance)} vs ledger ${formatQty(d.ledgerBalance)} ${i.unit}`);
          }
        },
        error: (err) => this.toast.apiError(err),
      });
  }

  isInbound(m: StockMovement): boolean {
    return m.quantity > 0;
  }

  // ---- Categories ----------------------------------------------------------------------
  newCategory(): void {
    this.editingCategory = null;
    this.categoryForm = { name: '', description: '', parentId: '', sortOrder: this.categories().length + 1 };
    this.categoryError = null;
    this.showCategoryForm = true;
  }

  editCategory(c: InventoryCategory): void {
    this.editingCategory = c;
    this.categoryForm = { name: c.name, description: c.description ?? '', parentId: c.parentId ?? '', sortOrder: c.sortOrder ?? 0 };
    this.categoryError = null;
    this.showCategoryForm = true;
  }

  saveCategory(): void {
    const f = this.categoryForm;
    if (!f.name.trim()) {
      this.categoryError = 'Name is required.';
      return;
    }
    const body = { name: f.name.trim(), description: f.description.trim(), parentId: f.parentId || null, sortOrder: Number(f.sortOrder) || 0 };
    this.saving = true;
    const req = this.editingCategory
      ? this.api.patch(`/inventory/categories/${this.editingCategory.id}`, body)
      : this.api.post('/inventory/categories', body);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showCategoryForm = false;
        this.toast.success(this.editingCategory ? 'Category updated' : 'Category added');
        this.load();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.categoryError = err.message;
      },
    });
  }

  async deleteCategory(c: InventoryCategory): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete ${c.name}?`,
      message: this.itemsInCategory(c.id) ? `${this.itemsInCategory(c.id)} item(s) are in this category.` : undefined,
      confirmText: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.delete(`/inventory/categories/${c.id}`).subscribe({
      next: () => {
        this.toast.success(`${c.name} deleted`);
        this.load();
      },
      error: (err) => this.toast.apiError(err),
    });
  }

  trackById(_: number, row: { id: string }): string {
    return row.id;
  }

  /** Average cost is stored per base unit in minor units (may be fractional). */
  unitCost(i: InventoryItemFull): number {
    return i.averageCost ?? 0;
  }

  readonly fromCents = fromCents;

  private shortageMessage(err: ApiError): string {
    const d = err.details as { available?: number; required?: number } | undefined;
    if (err.code === 'INSUFFICIENT_STOCK' && d?.available !== undefined) {
      return `${err.message}. Available: ${formatQty(d.available)}.`;
    }
    return err.message;
  }

  private blankItem(): ItemForm {
    return {
      name: '',
      sku: '',
      barcode: '',
      description: '',
      categoryId: '',
      unit: 'pcs',
      purchaseUnitName: '',
      purchaseUnitFactor: 1,
      reorderLevel: 0,
      reorderQuantity: 0,
      parLevel: 0,
      preferredSupplierId: '',
      storageLocation: '',
      isPerishable: false,
      shelfLifeDays: null,
      isActive: true,
    };
  }
}
