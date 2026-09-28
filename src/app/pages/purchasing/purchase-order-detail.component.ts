import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { formatQty, fromCents, toCents } from '../../core/format';
import { ApiError, ApiItem, PurchaseOrder, PurchaseOrderLine } from '../../core/models';
import { LabelPipe, MoneyPipe, TzDatePipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';
import { ModalComponent } from '../../shared/modal.component';
import { StatusPillComponent } from '../../shared/status-pill.component';

interface ReceiptRow {
  line: PurchaseOrderLine;
  quantity: number | null;
  unitCost: number | null;
}

const STEPS = ['draft', 'submitted', 'partially_received', 'received'];

@Component({
  selector: 'app-purchase-order-detail',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, RouterLink, MoneyPipe, TzDatePipe, LabelPipe, StatusPillComponent, ModalComponent],
  template: `
    <div *ngIf="loading()" class="d-grid gap-3"><span class="skeleton" style="height: 56px"></span><span class="skeleton" style="height: 280px"></span></div>

    <ng-container *ngIf="po() as p">
      <div class="page-header">
        <div>
          <a routerLink="/purchase-orders" class="text-muted text-xs fw-medium"><i class="bi bi-arrow-left me-1"></i>Purchase orders</a>
          <h1 class="mt-1 d-flex align-items-center gap-2">{{ p.poNumber }} <app-status-pill [status]="p.status"></app-status-pill></h1>
          <p>{{ supplierName() }} · created {{ p.createdAt | tzDate: 'datetime' }}</p>
        </div>
        <div class="d-flex flex-wrap gap-2">
          <button *ngIf="canSubmit() && p.status === 'draft'" type="button" class="btn btn-primary" [disabled]="busy" (click)="submit()">
            <i class="bi bi-send me-1"></i>Submit to supplier
          </button>
          <button *ngIf="canReceive() && (p.status === 'submitted' || p.status === 'partially_received')" type="button" class="btn btn-success" (click)="openReceive()">
            <i class="bi bi-box-arrow-in-down me-1"></i>Receive goods
          </button>
          <button *ngIf="canCancel() && (p.status === 'draft' || p.status === 'submitted') && !anyReceived()" type="button" class="btn btn-light border text-danger" [disabled]="busy" (click)="cancel()">
            <i class="bi bi-x-octagon me-1"></i>Cancel PO
          </button>
        </div>
      </div>

      <!-- Progress -->
      <div class="card mb-3" *ngIf="p.status !== 'cancelled'">
        <div class="card-body py-3">
          <div class="steps">
            <div *ngFor="let s of steps; let i = index" class="step" [class.done]="stepIndex() >= i" [class.current]="stepIndex() === i">
              <span class="bullet"><i *ngIf="stepIndex() > i" class="bi bi-check"></i><ng-container *ngIf="stepIndex() <= i">{{ i + 1 }}</ng-container></span>
              <span class="step-label">{{ s | label }}</span>
            </div>
          </div>
        </div>
      </div>
      <div *ngIf="p.status === 'cancelled'" class="alert alert-danger">
        <i class="bi bi-x-octagon me-1"></i>Cancelled {{ p.cancelledAt | tzDate: 'datetime' }}<span *ngIf="p.cancelReason">: {{ p.cancelReason }}</span>
      </div>

      <div class="row g-3">
        <div class="col-xl-8">
          <div class="card">
            <div class="card-header"><h2 class="card-title-sm">Lines</h2></div>
            <div class="table-responsive">
              <table class="table table-app">
                <thead>
                  <tr><th>Item</th><th class="text-end">Ordered</th><th style="min-width: 160px">Received</th><th class="text-end">Unit cost</th><th class="text-end">Tax</th><th class="text-end">Total</th></tr>
                </thead>
                <tbody>
                  <tr *ngFor="let l of p.items">
                    <td>
                      <div class="fw-medium">{{ l.itemName }}</div>
                      <div class="text-muted text-2xs">1 {{ l.purchaseUnit }} = {{ fq(l.conversionFactor) }} {{ l.baseUnit }}</div>
                    </td>
                    <td class="text-end tabular">{{ fq(l.quantityOrdered) }} {{ l.purchaseUnit }}</td>
                    <td>
                      <div class="d-flex justify-content-between text-xs"><span class="tabular">{{ fq(l.quantityReceived) }} / {{ fq(l.quantityOrdered) }}</span>
                        <span *ngIf="l.quantityOutstanding > 0 && p.status !== 'draft'" class="text-warning">{{ fq(l.quantityOutstanding) }} due</span></div>
                      <div class="progress mt-1" style="height: 5px"><div class="progress-bar bg-success" [style.width.%]="(l.quantityReceived / l.quantityOrdered) * 100"></div></div>
                    </td>
                    <td class="text-end tabular">{{ l.unitCost | money }}</td>
                    <td class="text-end tabular">{{ l.taxRate }}%</td>
                    <td class="text-end tabular fw-semibold">{{ l.lineTotal | money }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="col-xl-4">
          <div class="card">
            <div class="card-header"><h2 class="card-title-sm">Totals</h2></div>
            <div class="card-body">
              <dl class="kv">
                <div><dt>Subtotal</dt><dd>{{ p.subtotal | money }}</dd></div>
                <div><dt>Tax</dt><dd>{{ p.taxTotal | money }}</dd></div>
                <div><dt>Shipping</dt><dd>{{ p.shippingCost | money }}</dd></div>
                <div class="grand"><dt>Total</dt><dd>{{ p.grandTotal | money }}</dd></div>
              </dl>
            </div>
          </div>
          <div class="card mt-3">
            <div class="card-header"><h2 class="card-title-sm">Details</h2></div>
            <div class="card-body">
              <dl class="kv">
                <div><dt>Supplier</dt><dd>{{ supplierName() }}</dd></div>
                <div *ngIf="supplierContact()"><dt>Contact</dt><dd>{{ supplierContact() }}</dd></div>
                <div><dt>Expected</dt><dd>{{ p.expectedDeliveryDate ? (p.expectedDeliveryDate | tzDate: 'date') : '—' }}</dd></div>
                <div *ngIf="p.submittedAt"><dt>Submitted</dt><dd>{{ p.submittedAt | tzDate: 'datetime' }}</dd></div>
                <div *ngIf="p.receivedAt"><dt>Received</dt><dd>{{ p.receivedAt | tzDate: 'datetime' }}</dd></div>
                <div *ngIf="p.notes"><dt>Notes</dt><dd>{{ p.notes }}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <app-modal [open]="receiving" title="Receive goods" [subtitle]="p.poNumber + ' · stock increases for each line you receive'" size="lg" [dismissible]="false" (closed)="receiving = false">
        <div class="table-responsive">
          <table class="table table-app">
            <thead><tr><th>Item</th><th class="text-end">Outstanding</th><th style="width: 170px">Receive now</th><th style="width: 170px">Actual unit cost</th></tr></thead>
            <tbody>
              <tr *ngFor="let r of receipts">
                <td class="fw-medium">{{ r.line.itemName }}</td>
                <td class="text-end tabular">{{ fq(r.line.quantityOutstanding) }} {{ r.line.purchaseUnit }}</td>
                <td>
                  <div class="input-group input-group-sm">
                    <input type="number" class="form-control" min="0" [max]="r.line.quantityOutstanding" step="any" [(ngModel)]="r.quantity" />
                    <span class="input-group-text">{{ r.line.purchaseUnit }}</span>
                  </div>
                </td>
                <td>
                  <div class="input-group input-group-sm">
                    <span class="input-group-text">{{ auth.currency() }}</span>
                    <input type="number" class="form-control" min="0" step="0.01" [(ngModel)]="r.unitCost" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="text-muted text-xs mt-2">Leave a line at 0 to skip it. Change the unit cost only if the invoice price differs.</div>
        <div *ngIf="receiveError" class="alert alert-danger py-2 px-3 mt-3 mb-0">{{ receiveError }}</div>
        <ng-container modal-footer>
          <button type="button" class="btn btn-light border" (click)="receiving = false" [disabled]="busy">Cancel</button>
          <button type="button" class="btn btn-light border" (click)="fillAll()" [disabled]="busy">Receive everything</button>
          <button type="button" class="btn btn-success" (click)="receive()" [disabled]="busy">
            <span *ngIf="busy" class="spinner-border spinner-border-sm me-2"></span>Confirm receipt
          </button>
        </ng-container>
      </app-modal>
    </ng-container>
  `,
  styles: [
    `
      .steps { display: flex; gap: 0.5rem; }
      .step { flex: 1; display: flex; align-items: center; gap: 0.5rem; color: #94a3b8; font-weight: 500; }
      .step + .step::before { content: ''; flex: 0 0 24px; height: 2px; background: #e3e8ef; margin-right: 0.25rem; }
      .bullet { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: #eef1f6; font-size: 0.75rem; font-weight: 600; flex-shrink: 0; }
      .step.done { color: #0f172a; }
      .step.done .bullet { background: var(--bs-primary); color: #fff; }
      .step.current .bullet { box-shadow: 0 0 0 4px rgba(43, 89, 195, 0.15); }
      .kv { margin: 0; }
      .kv > div { display: flex; justify-content: space-between; gap: 1rem; padding: 0.35rem 0; }
      .kv dt { font-weight: 400; color: #64748b; }
      .kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
      .kv .grand { border-top: 1px solid var(--app-border); margin-top: 0.375rem; padding-top: 0.625rem; font-size: 1.0625rem; }
      .kv .grand dt, .kv .grand dd { color: #0f172a; font-weight: 700; }
      @media (max-width: 575.98px) { .step-label { display: none; } }
    `,
  ],
})
export class PurchaseOrderDetailComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);

  readonly po = signal<PurchaseOrder | null>(null);
  readonly loading = signal(true);
  readonly steps = STEPS;
  readonly fq = formatQty;

  // purchasing.routes.js: submit & cancel = manager; receive = manager or inventory clerk
  readonly canSubmit = computed(() => this.auth.hasRole('manager'));
  readonly canCancel = computed(() => this.auth.hasRole('manager'));
  readonly canReceive = computed(() => this.auth.hasRole('manager', 'inventory_clerk'));

  readonly stepIndex = computed(() => {
    const s = this.po()?.status ?? 'draft';
    return s === 'closed' || s === 'received' ? STEPS.length : STEPS.indexOf(s);
  });

  busy = false;
  receiving = false;
  receipts: ReceiptRow[] = [];
  receiveError: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  load(): void {
    this.api.get<ApiItem<PurchaseOrder>>(`/purchase-orders/${this.id}`).subscribe({
      next: (res) => {
        this.po.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err, 'Purchase order not found');
        this.loading.set(false);
      },
    });
  }

  supplierName(): string {
    const s = this.po()?.supplierId;
    return s && typeof s === 'object' ? s.name : '—';
  }

  supplierContact(): string {
    const s = this.po()?.supplierId;
    return s && typeof s === 'object' ? [s.email, s.phone].filter(Boolean).join(' · ') : '';
  }

  anyReceived(): boolean {
    return (this.po()?.items ?? []).some((l) => l.quantityReceived > 0);
  }

  async submit(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Submit this purchase order?', message: 'It will be marked as sent to the supplier and can then be received.', confirmText: 'Submit' });
    if (!ok) return;
    this.busy = true;
    this.api.post<ApiItem<PurchaseOrder>>(`/purchase-orders/${this.id}/submit`).subscribe({
      next: (res) => {
        this.busy = false;
        this.load();
        this.toast.success(`${res.data.poNumber} submitted`);
      },
      error: (err) => {
        this.busy = false;
        this.toast.apiError(err);
      },
    });
  }

  async cancel(): Promise<void> {
    const r = await this.confirm.ask({
      title: 'Cancel this purchase order?',
      confirmText: 'Cancel PO',
      tone: 'danger',
      reason: { label: 'Reason', placeholder: 'e.g. Supplier out of stock' },
    });
    if (!r) return;
    this.busy = true;
    this.api.post<ApiItem<PurchaseOrder>>(`/purchase-orders/${this.id}/cancel`, { reason: r.reason || undefined }).subscribe({
      next: (res) => {
        this.busy = false;
        this.load();
        this.toast.success(`${res.data.poNumber} cancelled`);
      },
      error: (err) => {
        this.busy = false;
        this.toast.apiError(err);
      },
    });
  }

  openReceive(): void {
    this.receipts = (this.po()?.items ?? [])
      .filter((l) => l.quantityOutstanding > 0)
      .map((line) => ({ line, quantity: line.quantityOutstanding, unitCost: fromCents(line.unitCost) }));
    this.receiveError = null;
    this.receiving = true;
  }

  fillAll(): void {
    this.receipts.forEach((r) => (r.quantity = r.line.quantityOutstanding));
  }

  receive(): void {
    const rows = this.receipts.filter((r) => Number(r.quantity) > 0);
    if (!rows.length) {
      this.receiveError = 'Enter a quantity for at least one line.';
      return;
    }
    const over = rows.find((r) => Number(r.quantity) > r.line.quantityOutstanding + 1e-9);
    if (over) {
      this.receiveError = `Over-receipt on "${over.line.itemName}": only ${formatQty(over.line.quantityOutstanding)} outstanding.`;
      return;
    }
    const receipts = rows.map((r) => {
      const receipt: Record<string, unknown> = { lineId: r.line.id, quantity: Number(r.quantity) };
      const cents = toCents(r.unitCost);
      if (r.unitCost !== null && cents !== r.line.unitCost) receipt['unitCost'] = cents;
      return receipt;
    });
    this.busy = true;
    this.receiveError = null;
    this.api.post<ApiItem<{ purchaseOrder: PurchaseOrder; movements: unknown[] }>>(`/purchase-orders/${this.id}/receive`, { receipts }).subscribe({
      next: (res) => {
        this.busy = false;
        this.receiving = false;
        this.load();
        this.toast.success('Goods received', `${res.data.movements.length} item(s) added to stock`);
      },
      error: (err: ApiError) => {
        this.busy = false;
        this.receiveError = err.message;
      },
    });
  }
}
