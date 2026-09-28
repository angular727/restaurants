import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PAYMENT_METHODS, PaymentMethod } from '../../core/enums';
import { formatMoney, fromCents, toCents, uuid } from '../../core/format';
import { ApiError, Order, Payment } from '../../core/models';
import { LabelPipe, MoneyPipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';
import { ModalComponent } from '../../shared/modal.component';

const METHOD_ICONS: Record<PaymentMethod, string> = {
  cash: 'bi-cash-coin',
  card: 'bi-credit-card',
  mobile_wallet: 'bi-phone',
  bank_transfer: 'bi-bank',
  voucher: 'bi-ticket-perforated',
  other: 'bi-three-dots',
};

/**
 * Takes one payment against an order. Split bills = several payments.
 * Each attempt carries an Idempotency-Key, reused on retry so a flaky network can't double-charge.
 */
@Component({
  selector: 'app-payment-dialog',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, ModalComponent, MoneyPipe, LabelPipe],
  template: `
    <app-modal [open]="open" title="Take payment" [subtitle]="order ? order.orderNumber + ' · Balance due ' + money(order.balanceDue ?? 0) : ''" size="md" [dismissible]="false" (closed)="close()">
      <ng-container *ngIf="order">
        <label class="form-label fw-medium">Payment method</label>
        <div class="method-grid mb-3">
          <button type="button" *ngFor="let m of methods" class="method" [class.active]="method === m" (click)="method = m">
            <i class="bi {{ icon(m) }}"></i>
            <span>{{ m | label }}</span>
          </button>
        </div>

        <div class="row g-3">
          <div class="col-sm-6">
            <label class="form-label fw-medium">Amount</label>
            <div class="input-group">
              <span class="input-group-text">{{ order.currency }}</span>
              <input type="number" class="form-control tabular" min="0.01" step="0.01" [(ngModel)]="amount" />
            </div>
            <div class="d-flex gap-1 mt-2">
              <button type="button" class="btn btn-sm btn-light border" (click)="amount = full()">Full</button>
              <button type="button" class="btn btn-sm btn-light border" (click)="split(2)">½ split</button>
              <button type="button" class="btn btn-sm btn-light border" (click)="split(3)">⅓ split</button>
            </div>
          </div>
          <div class="col-sm-6">
            <label class="form-label fw-medium">Tip <span class="text-muted fw-normal">(optional)</span></label>
            <div class="input-group">
              <span class="input-group-text">{{ order.currency }}</span>
              <input type="number" class="form-control tabular" min="0" step="0.01" [(ngModel)]="tip" />
            </div>
          </div>

          <div class="col-12" *ngIf="method === 'cash'">
            <label class="form-label fw-medium">Cash received</label>
            <div class="input-group">
              <span class="input-group-text">{{ order.currency }}</span>
              <input type="number" class="form-control tabular" min="0" step="0.01" [(ngModel)]="cashTendered" />
            </div>
            <div class="d-flex flex-wrap gap-1 mt-2">
              <button type="button" class="btn btn-sm btn-light border" *ngFor="let q of quickCash()" (click)="cashTendered = q / 100">
                {{ q | money: order.currency }}
              </button>
            </div>
            <div *ngIf="cashTendered !== null && cashTendered !== undefined && $any(cashTendered) !== ''" class="change-box mt-3" [class.short]="changeCents() < 0">
              <span>{{ changeCents() < 0 ? 'Still short' : 'Change due' }}</span>
              <strong class="tabular">{{ absChange() | money: order.currency }}</strong>
            </div>
          </div>

          <ng-container *ngIf="hasProvider()">
            <div class="col-12">
              <div class="section-title mb-2 mt-1">{{ method === 'card' ? 'Card terminal details' : 'Transaction details' }} <span class="text-muted fw-normal text-none">(optional)</span></div>
            </div>
            <div class="col-sm-6">
              <label class="form-label text-xs text-muted mb-1">Provider</label>
              <input class="form-control form-control-sm" [(ngModel)]="providerName" [placeholder]="method === 'card' ? 'e.g. Stripe, Square' : 'e.g. JazzCash, Easypaisa'" />
            </div>
            <div class="col-sm-6">
              <label class="form-label text-xs text-muted mb-1">Transaction ID</label>
              <input class="form-control form-control-sm" [(ngModel)]="transactionId" />
            </div>
            <ng-container *ngIf="method === 'card'">
              <div class="col-sm-4">
                <label class="form-label text-xs text-muted mb-1">Card brand</label>
                <select class="form-select form-select-sm" [(ngModel)]="cardBrand">
                  <option value="">—</option>
                  <option *ngFor="let b of cardBrands" [value]="b">{{ b }}</option>
                </select>
              </div>
              <div class="col-sm-4">
                <label class="form-label text-xs text-muted mb-1">Last 4 digits</label>
                <input class="form-control form-control-sm" maxlength="4" inputmode="numeric" [(ngModel)]="last4" [class.is-invalid]="!!last4 && !last4Valid()" placeholder="1234" />
              </div>
              <div class="col-sm-4">
                <label class="form-label text-xs text-muted mb-1">Auth code</label>
                <input class="form-control form-control-sm" [(ngModel)]="authCode" />
              </div>
              <div class="col-12 text-muted text-2xs"><i class="bi bi-shield-lock me-1"></i>Never enter the full card number. Only the last 4 digits are stored.</div>
            </ng-container>
          </ng-container>

          <div class="col-12">
            <label class="form-label text-xs text-muted mb-1">Note <span class="fw-normal">(optional)</span></label>
            <input class="form-control form-control-sm" maxlength="500" [(ngModel)]="note" placeholder="e.g. Paid by John for the table" />
          </div>
        </div>

        <div *ngIf="error" class="alert alert-danger py-2 px-3 mt-3 mb-0"><i class="bi bi-exclamation-circle me-1"></i>{{ error }}</div>
      </ng-container>

      <ng-container modal-footer>
        <button type="button" class="btn btn-light border" (click)="close()" [disabled]="saving">Cancel</button>
        <button type="button" class="btn btn-success" (click)="pay()" [disabled]="saving || !valid()">
          <span *ngIf="saving" class="spinner-border spinner-border-sm me-2"></span>
          Charge {{ chargeCents() | money: order?.currency }}
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: [
    `
      .method-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
      .method {
        display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
        border: 1px solid var(--app-border); background: #fff; border-radius: 10px;
        padding: 0.7rem 0.25rem; font-weight: 500; font-size: 0.8rem; color: #334155;
      }
      .method i { font-size: 1.2rem; }
      .method.active { border-color: var(--bs-primary); background: #eaf0fc; color: var(--bs-primary); box-shadow: 0 0 0 1px var(--bs-primary) inset; }
      .change-box {
        display: flex; justify-content: space-between; align-items: center;
        padding: 0.75rem 1rem; border-radius: 10px; background: #e8f6ee; color: #15803d;
      }
      .change-box strong { font-size: 1.25rem; }
      .change-box.short { background: #fdecec; color: #b91c1c; }
    `,
  ],
})
export class PaymentDialogComponent implements OnChanges {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  @Input() open = false;
  @Input() order: Order | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() paid = new EventEmitter<Order>();

  readonly methods = PAYMENT_METHODS;
  method: PaymentMethod = 'cash';
  amount: number | null = null;
  tip: number | null = null;
  cashTendered: number | null = null;
  note = '';
  providerName = '';
  transactionId = '';
  authCode = '';
  cardBrand = '';
  last4 = '';
  readonly cardBrands = ['Visa', 'Mastercard', 'American Express', 'UnionPay', 'Discover', 'JCB', 'Other'];
  saving = false;
  error: string | null = null;
  private idempotencyKey = uuid();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) this.reset();
  }

  icon(m: PaymentMethod): string {
    return METHOD_ICONS[m];
  }

  money(cents: number): string {
    return formatMoney(cents, this.order?.currency ?? this.auth.currency(), this.auth.locale());
  }

  full(): number {
    return fromCents(this.order?.balanceDue ?? 0) ?? 0;
  }

  split(ways: number): void {
    const due = this.order?.balanceDue ?? 0;
    this.amount = fromCents(Math.ceil(due / ways));
  }

  chargeCents(): number {
    return toCents(this.amount) + toCents(this.tip);
  }

  changeCents(): number {
    return toCents(this.cashTendered) - this.chargeCents();
  }

  absChange(): number {
    return Math.abs(this.changeCents());
  }

  /** Exact amount plus the next round notes above it, in cents. */
  quickCash(): number[] {
    const due = this.chargeCents();
    if (due <= 0) return [];
    const options = new Set<number>([due]);
    for (const step of [500, 1000, 2000, 5000, 10000]) options.add(Math.ceil(due / step) * step);
    return [...options].sort((a, b) => a - b).slice(0, 5);
  }

  hasProvider(): boolean {
    return this.method === 'card' || this.method === 'mobile_wallet' || this.method === 'bank_transfer';
  }

  last4Valid(): boolean {
    return /^\d{4}$/.test(this.last4);
  }

  valid(): boolean {
    if (this.method === 'card' && this.last4 && !this.last4Valid()) return false;
    const amount = toCents(this.amount);
    if (amount <= 0 || amount > (this.order?.balanceDue ?? 0)) return false;
    if (toCents(this.tip) < 0) return false;
    if (this.method === 'cash' && this.cashTendered !== null && this.cashTendered !== undefined && this.changeCents() < 0) return false;
    return true;
  }

  close(): void {
    if (!this.saving) this.closed.emit();
  }

  pay(): void {
    if (!this.order || !this.valid()) return;
    this.saving = true;
    this.error = null;
    const body: Record<string, unknown> = { method: this.method, amount: toCents(this.amount) };
    if (toCents(this.tip) > 0) body['tipAmount'] = toCents(this.tip);
    if (this.method === 'cash' && this.cashTendered) body['cashTendered'] = toCents(this.cashTendered);
    if (this.note.trim()) body['note'] = this.note.trim();
    if (this.hasProvider()) {
      const provider: Record<string, string> = {};
      if (this.providerName.trim()) provider['name'] = this.providerName.trim();
      if (this.transactionId.trim()) provider['transactionId'] = this.transactionId.trim();
      if (this.method === 'card') {
        if (this.authCode.trim()) provider['authCode'] = this.authCode.trim();
        if (this.cardBrand) provider['cardBrand'] = this.cardBrand;
        if (this.last4) provider['last4'] = this.last4;
      }
      if (Object.keys(provider).length) body['provider'] = provider;
    }

    this.api
      .post<{ data: { payment: Payment; order: Order } }>(`/orders/${this.order.id}/payments`, body, {
        'Idempotency-Key': this.idempotencyKey,
      })
      .subscribe({
        next: (res) => {
          this.saving = false;
          const { payment, order } = res.data;
          const change = payment.changeDue ? ` · Change ${this.money(payment.changeDue)}` : '';
          this.toast.success(`Payment of ${this.money(payment.amount)} received`, `${payment.method.replace('_', ' ')}${change}`);
          this.idempotencyKey = uuid();
          this.paid.emit(order);
        },
        error: (err: ApiError) => {
          this.saving = false;
          this.error = err.message;
          // Keep the same key after a network failure so a retry can't charge twice.
          if (err.status !== 0) this.idempotencyKey = uuid();
        },
      });
  }

  private reset(): void {
    this.method = 'cash';
    this.amount = this.full();
    this.tip = null;
    this.cashTendered = null;
    this.note = '';
    this.providerName = '';
    this.transactionId = '';
    this.authCode = '';
    this.cardBrand = '';
    this.last4 = '';
    this.error = null;
    this.saving = false;
    this.idempotencyKey = uuid();
  }
}
