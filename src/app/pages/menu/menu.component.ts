import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ALLERGENS, DIETARY_TAGS } from '../../core/enums';
import { formatQty, fromCents, toCents } from '../../core/format';
import { ApiError, ApiItem, FoodCost, InventoryItemFull, MenuCategory, MenuItem } from '../../core/models';
import { LabelPipe, MoneyPipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';
import { ModalComponent } from '../../shared/modal.component';

interface RecipeRow {
  inventoryItemId: string;
  quantity: number | null;
  wastagePercent: number | null;
  note: string;
}

interface ItemForm {
  categoryId: string;
  name: string;
  description: string;
  sku: string;
  imageUrl: string;
  price: number | null;
  useDefaultTax: boolean;
  taxRate: number | null;
  tags: string;
  dietary: string[];
  allergens: string[];
  preparationTimeMinutes: number | null;
  kitchenStation: string;
  isAvailable: boolean;
  isActive: boolean;
  trackInventory: boolean;
  sortOrder: number;
  recipe: RecipeRow[];
}

interface CategoryForm {
  name: string;
  description: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
  availableFrom: string;
  availableTo: string;
}

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, MoneyPipe, LabelPipe, ModalComponent],
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss'],
})
export class MenuComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  readonly tab = signal<'items' | 'categories'>('items');
  readonly loading = signal(true);
  readonly items = signal<MenuItem[]>([]);
  readonly categories = signal<MenuCategory[]>([]);
  readonly inventory = signal<InventoryItemFull[]>([]);

  // Filters
  readonly search = signal('');
  readonly categoryFilter = signal('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive' | 'unavailable'>('all');

  // Role checks mirror menu.routes.js
  readonly canEditItems = computed(() => this.auth.hasRole('manager', 'chef'));
  readonly canEditCategories = computed(() => this.auth.hasRole('manager'));
  readonly canToggleAvailability = computed(() => this.auth.hasRole('manager', 'chef', 'waiter'));
  readonly canSeeFoodCost = computed(() => this.auth.hasRole('manager', 'chef'));
  readonly canReadInventory = computed(() => true);

  readonly dietaryTags = DIETARY_TAGS;
  readonly allergenList = ALLERGENS;
  readonly formatQty = formatQty;

  readonly filteredItems = computed(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.categoryFilter();
    const status = this.statusFilter();
    return this.items().filter((i) => {
      if (cat && i.categoryId !== cat) return false;
      if (status === 'active' && !i.isActive) return false;
      if (status === 'inactive' && i.isActive) return false;
      if (status === 'unavailable' && i.isAvailable) return false;
      return !q || i.name.toLowerCase().includes(q) || (i.sku ?? '').toLowerCase().includes(q);
    });
  });

  // Item dialog
  showItemForm = false;
  editingItem: MenuItem | null = null;
  itemForm: ItemForm = this.blankItem();
  itemError: string | null = null;
  saving = false;

  // Category dialog
  showCategoryForm = false;
  editingCategory: MenuCategory | null = null;
  categoryForm: CategoryForm = this.blankCategory();
  categoryError: string | null = null;

  // Food cost dialog
  foodCost: FoodCost | null = null;
  foodCostItem: MenuItem | null = null;
  togglingId: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({
      items: this.api.getAll<MenuItem>('/menu/items'),
      categories: this.api.getAll<MenuCategory>('/menu/categories'),
    }).subscribe({
      next: ({ items, categories }) => {
        this.items.set(items);
        this.categories.set(categories);
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err);
        this.loading.set(false);
      },
    });
  }

  private loadInventory(): void {
    if (this.inventory().length) return;
    this.api.getAll<InventoryItemFull>('/inventory/items', { isActive: true }).subscribe({
      next: (list) => this.inventory.set(list),
      error: () => this.inventory.set([]),
    });
  }

  categoryName(id: string): string {
    return this.categories().find((c) => c.id === id)?.name ?? '—';
  }

  itemsInCategory(id: string): number {
    return this.items().filter((i) => i.categoryId === id).length;
  }

  inventoryName(id: string): string {
    return this.inventory().find((i) => i.id === id)?.name ?? 'Unknown item';
  }

  inventoryUnit(id: string): string {
    return this.inventory().find((i) => i.id === id)?.unit ?? '';
  }

  // ---- Availability ("86") ------------------------------------------------------------
  toggleAvailability(item: MenuItem): void {
    this.togglingId = item.id;
    this.api.post<ApiItem<MenuItem>>(`/menu/items/${item.id}/availability`, { isAvailable: !item.isAvailable }).subscribe({
      next: (res) => {
        this.togglingId = null;
        this.items.update((list) => list.map((i) => (i.id === res.data.id ? res.data : i)));
        this.toast.success(`${res.data.name} is now ${res.data.isAvailable ? 'available' : 'unavailable'}`);
      },
      error: (err) => {
        this.togglingId = null;
        this.toast.apiError(err);
      },
    });
  }

  // ---- Food cost ---------------------------------------------------------------------
  showFoodCost(item: MenuItem): void {
    this.foodCostItem = item;
    this.foodCost = null;
    this.api.get<ApiItem<FoodCost>>(`/menu/items/${item.id}/food-cost`).subscribe({
      next: (res) => (this.foodCost = res.data),
      error: (err) => {
        this.foodCostItem = null;
        this.toast.apiError(err);
      },
    });
  }

  foodCostTone(pct: number): string {
    return pct <= 30 ? 'text-success' : pct <= 38 ? 'text-warning' : 'text-danger';
  }

  // ---- Item CRUD -----------------------------------------------------------------------
  newItem(): void {
    this.loadInventory();
    this.editingItem = null;
    this.itemForm = this.blankItem();
    this.itemForm.categoryId = this.categoryFilter() || this.categories()[0]?.id || '';
    this.itemError = null;
    this.showItemForm = true;
  }

  editItem(item: MenuItem): void {
    this.loadInventory();
    this.editingItem = item;
    this.itemForm = {
      categoryId: item.categoryId,
      name: item.name,
      description: item.description ?? '',
      sku: item.sku ?? '',
      imageUrl: item.imageUrl ?? '',
      price: fromCents(item.price),
      useDefaultTax: item.taxRate === null || item.taxRate === undefined,
      taxRate: item.taxRate ?? null,
      tags: (item.tags ?? []).join(', '),
      dietary: [...(item.dietary ?? [])],
      allergens: [...(item.allergens ?? [])],
      preparationTimeMinutes: item.preparationTimeMinutes ?? null,
      kitchenStation: item.kitchenStation ?? '',
      isAvailable: item.isAvailable,
      isActive: item.isActive,
      trackInventory: item.trackInventory,
      sortOrder: item.sortOrder ?? 0,
      recipe: (item.recipe ?? []).map((r) => ({
        inventoryItemId: String(r.inventoryItemId),
        quantity: r.quantity,
        wastagePercent: r.wastagePercent ?? 0,
        note: r.note ?? '',
      })),
    };
    this.itemError = null;
    this.showItemForm = true;
  }

  toggleIn(list: string[], value: string): void {
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
    else list.push(value);
  }

  addRecipeRow(): void {
    this.itemForm.recipe.push({ inventoryItemId: '', quantity: null, wastagePercent: 0, note: '' });
  }

  removeRecipeRow(i: number): void {
    this.itemForm.recipe.splice(i, 1);
  }

  saveItem(): void {
    const f = this.itemForm;
    const problems: string[] = [];
    if (!f.name.trim()) problems.push('Name is required.');
    if (!f.categoryId) problems.push('Choose a category.');
    if (f.price === null || f.price === undefined || f.price < 0) problems.push('Enter a valid price.');
    if (!f.useDefaultTax && (f.taxRate === null || f.taxRate < 0 || f.taxRate > 100)) problems.push('Tax rate must be 0–100%.');
    const rows = f.recipe.filter((r) => r.inventoryItemId);
    if (rows.some((r) => !(Number(r.quantity) > 0))) problems.push('Every recipe ingredient needs a quantity above 0.');
    if (new Set(rows.map((r) => r.inventoryItemId)).size !== rows.length) problems.push('Each ingredient may appear only once in a recipe.');
    if (problems.length) {
      this.itemError = problems.join(' ');
      return;
    }

    const body = {
      categoryId: f.categoryId,
      name: f.name.trim(),
      description: f.description.trim(),
      sku: f.sku.trim(),
      imageUrl: f.imageUrl.trim(),
      price: toCents(f.price),
      taxRate: f.useDefaultTax ? null : Number(f.taxRate),
      tags: f.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      dietary: f.dietary,
      allergens: f.allergens,
      preparationTimeMinutes: f.preparationTimeMinutes ?? undefined,
      kitchenStation: f.kitchenStation.trim(),
      isAvailable: f.isAvailable,
      isActive: f.isActive,
      trackInventory: f.trackInventory,
      sortOrder: Number(f.sortOrder) || 0,
      recipe: rows.map((r) => ({
        inventoryItemId: r.inventoryItemId,
        quantity: Number(r.quantity),
        wastagePercent: Number(r.wastagePercent) || 0,
        ...(r.note.trim() && { note: r.note.trim() }),
      })),
    };

    this.saving = true;
    this.itemError = null;
    const req = this.editingItem ? this.api.patch(`/menu/items/${this.editingItem.id}`, body) : this.api.post('/menu/items', body);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showItemForm = false;
        this.toast.success(this.editingItem ? `${body.name} updated` : `${body.name} added to the menu`);
        this.load();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.itemError = this.describe(err);
      },
    });
  }

  async deleteItem(item: MenuItem): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete ${item.name}?`,
      message: 'It will be removed from the menu. Past orders keep their line items.',
      confirmText: 'Delete item',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.delete(`/menu/items/${item.id}`).subscribe({
      next: () => {
        this.toast.success(`${item.name} deleted`);
        this.load();
      },
      error: (err) => this.toast.apiError(err),
    });
  }

  // ---- Category CRUD ---------------------------------------------------------------------
  newCategory(): void {
    this.editingCategory = null;
    this.categoryForm = this.blankCategory();
    this.categoryForm.sortOrder = this.categories().length + 1;
    this.categoryError = null;
    this.showCategoryForm = true;
  }

  editCategory(c: MenuCategory): void {
    this.editingCategory = c;
    this.categoryForm = {
      name: c.name,
      description: c.description ?? '',
      imageUrl: c.imageUrl ?? '',
      sortOrder: c.sortOrder ?? 0,
      isActive: c.isActive,
      availableFrom: c.availableFrom ?? '',
      availableTo: c.availableTo ?? '',
    };
    this.categoryError = null;
    this.showCategoryForm = true;
  }

  saveCategory(): void {
    const f = this.categoryForm;
    if (!f.name.trim()) {
      this.categoryError = 'Name is required.';
      return;
    }
    const body: Record<string, unknown> = {
      name: f.name.trim(),
      description: f.description.trim(),
      imageUrl: f.imageUrl.trim(),
      sortOrder: Number(f.sortOrder) || 0,
      isActive: f.isActive,
    };
    if (f.availableFrom) body['availableFrom'] = f.availableFrom;
    if (f.availableTo) body['availableTo'] = f.availableTo;

    this.saving = true;
    const req = this.editingCategory
      ? this.api.patch(`/menu/categories/${this.editingCategory.id}`, body)
      : this.api.post('/menu/categories', body);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showCategoryForm = false;
        this.toast.success(this.editingCategory ? 'Category updated' : 'Category added');
        this.load();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.categoryError = this.describe(err);
      },
    });
  }

  async deleteCategory(c: MenuCategory): Promise<void> {
    const count = this.itemsInCategory(c.id);
    const ok = await this.confirm.ask({
      title: `Delete ${c.name}?`,
      message: count
        ? `${count} menu item(s) still use this category. Move them first, or they will point to a deleted category.`
        : 'The category will be removed from the menu.',
      confirmText: 'Delete category',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.delete(`/menu/categories/${c.id}`).subscribe({
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

  /** Validation errors carry field details; show them all. */
  private describe(err: ApiError): string {
    const details = err.details as { path?: string; message: string }[] | undefined;
    if (Array.isArray(details) && details.length) return details.map((d) => d.message).join(' ');
    return err.message;
  }

  private blankItem(): ItemForm {
    return {
      categoryId: '',
      name: '',
      description: '',
      sku: '',
      imageUrl: '',
      price: null,
      useDefaultTax: true,
      taxRate: null,
      tags: '',
      dietary: [],
      allergens: [],
      preparationTimeMinutes: null,
      kitchenStation: '',
      isAvailable: true,
      isActive: true,
      trackInventory: true,
      sortOrder: 0,
      recipe: [],
    };
  }

  private blankCategory(): CategoryForm {
    return { name: '', description: '', imageUrl: '', sortOrder: 0, isActive: true, availableFrom: '', availableTo: '' };
  }
}
