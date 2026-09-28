import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { formatQty, toCents } from '../../core/format';
import { ApiError, ApiItem, InventoryItemFull, PurchaseOrder, Supplier } from '../../core/models';
import { LabelPipe, MoneyPipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';

interface Line {
  key: number;
  inventoryItemId: string;
  quantityOrdered: number | null;
  unitCost: number | null;
  taxRate: number | null;
}

@Component({
  selector: 'app-purchase-order-form',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, RouterLink, MoneyPipe, LabelPipe],
  template: `
    <div class="page-header">
      <div>
        <a routerLink="/purchase-orders" class="text-muted text-xs fw-medium"><i class="bi bi-arrow-left me-1"></i>Purchase orders</a>
        <h1 class="mt-1">New purchase order</h1>
        <p>Saved as a draft. A manager submits it to the supplier.</p>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-xl-8">
        <div class="card">
          <div class="card-header"><h2 class="card-title-sm">Supplier & delivery</h2></div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label fw-medium required">Supplier</label>
                <select class="form-select" [(ngModel)]="supplierId">
                  <option value="" disabled>Choose a supplier…</option>
                  <option *ngFor="let s of activeSuppliers()" [value]="s.id">{{ s.name }}</option>
                </select>
                <div *ngIf="supplier() as s" class="text-muted text-xs mt-1">{{ s.paymentTerms | label }} · lead time {{ s.leadTimeDays }} day(s)</div>
              </div>
              <div class="col-md-3">
                <label class="form-label fw-medium">Expected delivery</label>
                <input type="date" class="form-control" [(ngModel)]="expectedDeliveryDate" />
              </div>
              <div class="col-md-3">
                <label class="form-label fw-medium">Shipping cost</label>
                <div class="input-group"><span class="input-group-text">{{ auth.currency() }}</span><input type="number" class="form-control" min="0" step="0.01" [(ngModel)]="shippingCost" /></div>
              </div>
              <div class="col-12">
                <label class="form-label fw-medium">Notes</label>
                <textarea class="form-control" rows="2" maxlength="2000" [(ngModel)]="notes"></textarea>
              </div>
            </div>
          </div>
        </div>

        <div class="card mt-3">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h2 class="card-title-sm">Lines</h2>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-sm btn-light border" [disabled]="!supplierId" (click)="addSuggestions()" title="Add low-stock items from this supplier">
                <i class="bi bi-lightning-charge me-1"></i>Add low-stock items
              </button>
              <button type="button" class="btn btn-sm btn-light border" (click)="addLine()"><i class="bi bi-plus-lg me-1"></i>Add line</button>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-app">
              <thead>
                <tr><th style="min-width: 220px">Item</th><th style="width: 150px">Quantity</th><th style="width: 160px">Unit cost</th><th style="width: 110px">Tax %</th><th class="text-end">Line total</th><th></th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let line of lines; let i = index">
                  <td>
                    <select class="form-select form-select-sm" [(ngModel)]="line.inventoryItemId" (ngModelChange)="onItemChange(line)">
                      <option value="" disabled>Choose item…</option>
                      <option *ngFor="let inv of sortedItems()" [value]="inv.id">{{ inv.name }}{{ inv.preferredSupplierId === supplierId && supplierId ? ' ★' : '' }}</option>
                    </select>
                    <div *ngIf="item(line.inventoryItemId) as inv" class="text-muted text-2xs mt-1">
                      In stock {{ fq(inv.currentStock) }} {{ inv.unit }} · 1 {{ purchaseUnit(inv) }} = {{ fq(inv.purchaseUnit?.factor ?? 1) }} {{ inv.unit }}
                    </div>
                  </td>
                  <td>
                    <div class="input-group input-group-sm">
                      <input type="number" class="form-control" min="0" step="any" [(ngModel)]="line.quantityOrdered" />
                      <span class="input-group-text">{{ line.inventoryItemId ? purchaseUnit(item(line.inventoryItemId)) : 'unit' }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="input-group input-group-sm">
                      <span class="input-group-text">{{ auth.currency() }}</span>
                      <input type="number" class="form-control" min="0" step="0.01" [(ngModel)]="line.unitCost" />
                    </div>
                  </td>
                  <td><input type="number" class="form-control form-control-sm" min="0" max="100" step="any" [(ngModel)]="line.taxRate" /></td>
                  <td class="text-end tabular fw-medium">{{ lineTotal(line) | money }}</td>
                  <td class="text-end"><button type="button" class="btn btn-sm btn-link text-danger" (click)="lines.splice(i, 1)"><i class="bi bi-x-lg"></i></button></td>
                </tr>
                <tr *ngIf="!lines.length"><td colspan="6"><div class="empty-state py-4">Add at least one line.</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="col-xl-4">
        <div class="card sticky-summary">
          <div class="card-header"><h2 class="card-title-sm">Summary</h2></div>
          <div class="card-body">
            <dl class="po-summary">
              <div><dt>Subtotal</dt><dd>{{ subtotal() | money }}</dd></div>
              <div><dt>Tax</dt><dd>{{ tax() | money }}</dd></div>
              <div><dt>Shipping</dt><dd>{{ toCents(shippingCost) | money }}</dd></div>
              <div class="grand"><dt>Estimated total</dt><dd>{{ subtotal() + tax() + toCents(shippingCost) | money }}</dd></div>
            </dl>
            <div class="text-muted text-2xs mb-3">The server calculates the final totals.</div>
            <div *ngIf="error" class="alert alert-danger py-2 px-3">{{ error }}</div>
            <button type="button" class="btn btn-primary w-100" [disabled]="saving" (click)="save()">
              <span *ngIf="saving" class="spinner-border spinner-border-sm me-2"></span>Create draft
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .sticky-summary { position: sticky; top: calc(var(--app-topbar-height) + 1rem); }
      .po-summary { margin: 0 0 0.5rem; }
      .po-summary > div { display: flex; justify-content: space-between; padding: 0.3rem 0; }
      .po-summary dt { font-weight: 400; color: #64748b; }
      .po-summary dd { margin: 0; font-variant-numeric: tabular-nums; }
      .po-summary .grand { border-top: 1px solid var(--app-border); margin-top: 0.375rem; padding-top: 0.625rem; font-size: 1.0625rem; }
      .po-summary .grand dt, .po-summary .grand dd { color: #0f172a; font-weight: 700; }
    `,
  ],
})
export class PurchaseOrderFormComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);

  readonly suppliers = signal<Supplier[]>([]);
  readonly items = signal<InventoryItemFull[]>([]);
  readonly activeSuppliers = computed(() => this.suppliers().filter((s) => s.isActive));
  readonly toCents = toCents;
  readonly fq = formatQty;

  supplierId = '';
  expectedDeliveryDate = '';
  shippingCost: number | null = null;
  notes = '';
  lines: Line[] = [];
  saving = false;
  error: string | null = null;
  private nextKey = 1;

  readonly sortedItems = computed(() => [...this.items()].sort((a, b) => a.name.localeCompare(b.name)));

  ngOnInit(): void {
    forkJoin({
      suppliers: this.api.getAll<Supplier>('/suppliers'),
      items: this.api.getAll<InventoryItemFull>('/inventory/items', { isActive: true }),
    }).subscribe({
      next: ({ suppliers, items }) => {
        this.suppliers.set(suppliers);
        this.items.set(items);
      },
      error: (err) => this.toast.apiError(err),
    });
    this.addLine();
  }

  supplier(): Supplier | undefined {
    return this.suppliers().find((s) => s.id === this.supplierId);
  }

  item(id: string): InventoryItemFull | undefined {
    return this.items().find((i) => i.id === id);
  }

  purchaseUnit(inv?: InventoryItemFull): string {
    return inv?.purchaseUnit?.name || inv?.unit || 'unit';
  }

  addLine(): void {
    this.lines.push({ key: this.nextKey++, inventoryItemId: '', quantityOrdered: null, unitCost: null, taxRate: 0 });
  }

  /** Prefill the cost from the last purchase (stored per base unit, in minor units). */
  onItemChange(line: Line): void {
    const inv = this.item(line.inventoryItemId);
    if (!inv) return;
    const factor = inv.purchaseUnit?.factor ?? 1;
    const perBase = inv.lastPurchaseCost || inv.averageCost || 0;
    if (line.unitCost === null && perBase) line.unitCost = Math.round(perBase * factor) / 100;
  }

  /** Low-stock items whose preferred supplier is the chosen one, at their reorder quantity. */
  addSuggestions(): void {
    const existing = new Set(this.lines.map((l) => l.inventoryItemId));
    const picks = this.items().filter(
      (i) => i.preferredSupplierId === this.supplierId && i.currentStock <= i.reorderLevel && !existing.has(i.id)
    );
    if (!picks.length) {
      this.toast.info('No low-stock items for this supplier');
      return;
    }
    this.lines = this.lines.filter((l) => l.inventoryItemId);
    for (const inv of picks) {
      const factor = inv.purchaseUnit?.factor ?? 1;
      const qty = Math.max(1, Math.ceil((inv.reorderQuantity || inv.reorderLevel || factor) / factor));
      const line: Line = { key: this.nextKey++, inventoryItemId: inv.id, quantityOrdered: qty, unitCost: null, taxRate: 0 };
      this.onItemChange(line);
      this.lines.push(line);
    }
    this.toast.success(`Added ${picks.length} low-stock item(s)`);
  }

  lineTotal(line: Line): number {
    return Math.round((Number(line.quantityOrdered) || 0) * toCents(line.unitCost));
  }

  subtotal(): number {
    return this.lines.reduce((sum, l) => sum + this.lineTotal(l), 0);
  }

  tax(): number {
    return Math.round(this.lines.reduce((sum, l) => sum + this.lineTotal(l) * ((Number(l.taxRate) || 0) / 100), 0));
  }

  async save(): Promise<void> {
    const lines = this.lines.filter((l) => l.inventoryItemId);
    if (!this.supplierId) {
      this.error = 'Choose a supplier.';
      return;
    }
    if (!lines.length) {
      this.error = 'Add at least one line.';
      return;
    }
    if (lines.some((l) => !(Number(l.quantityOrdered) > 0) || l.unitCost === null || l.unitCost < 0)) {
      this.error = 'Every line needs a quantity above 0 and a unit cost.';
      return;
    }
    const body: Record<string, unknown> = {
      supplierId: this.supplierId,
      items: lines.map((l) => ({
        inventoryItemId: l.inventoryItemId,
        quantityOrdered: Number(l.quantityOrdered),
        unitCost: toCents(l.unitCost),
        taxRate: Number(l.taxRate) || 0,
      })),
    };
    if (this.expectedDeliveryDate) body['expectedDeliveryDate'] = this.expectedDeliveryDate;
    if (this.notes.trim()) body['notes'] = this.notes.trim();
    if (toCents(this.shippingCost) > 0) body['shippingCost'] = toCents(this.shippingCost);

    this.saving = true;
    this.error = null;
    try {
      const res = await firstValueFrom(this.api.post<ApiItem<PurchaseOrder>>('/purchase-orders', body));
      this.toast.success(`${res.data.poNumber} created as draft`);
      await this.router.navigate(['/purchase-orders', res.data.id]);
    } catch (err) {
      this.error = (err as ApiError).message;
    } finally {
      this.saving = false;
    }
  }
}
