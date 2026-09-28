import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PAYMENT_METHODS } from '../../core/enums';
import { midnightIn, startOfTodayIn } from '../../core/format';
import { ApiList, Payment } from '../../core/models';
import { LabelPipe, MoneyPipe, TzDatePipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';
import { PagerComponent } from '../../shared/pager.component';
import { RefundDialogComponent } from '../../shared/refund-dialog.component';

type Range = 'today' | 'yesterday' | '7d' | '30d' | 'custom' | 'all';

@Component({
  selector: 'app-payments',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, RouterLink, MoneyPipe, TzDatePipe, LabelPipe, PagerComponent, RefundDialogComponent],
  template: `
    <div class="page-header">
      <div>
        <h1>Payments</h1>
        <p>Every payment and refund taken at the till.</p>
      </div>
      <button type="button" class="btn btn-light border" (click)="load()" [disabled]="loading()"><i class="bi bi-arrow-clockwise me-1"></i>Refresh</button>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-6 col-lg-3" *ngFor="let k of kpis()">
        <div class="card h-100"><div class="card-body">
          <div class="text-muted text-xs mb-1">{{ k.label }}</div>
          <div class="fs-5 fw-bold tabular" [class.text-danger]="k.negative">{{ k.value | money }}</div>
          <div class="text-muted text-2xs mt-1">{{ k.hint }}</div>
        </div></div>
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-light border" *ngFor="let r of ranges" [class.active]="range === r.value" (click)="setRange(r.value)">{{ r.label }}</button>
        </div>
        <ng-container *ngIf="range === 'custom'">
          <input type="date" class="form-control form-control-sm w-auto" [(ngModel)]="fromDate" (change)="page = 1; load()" />
          <span class="text-muted">to</span>
          <input type="date" class="form-control form-control-sm w-auto" [(ngModel)]="toDate" (change)="page = 1; load()" />
        </ng-container>
        <select class="form-select form-select-sm w-auto" [(ngModel)]="method" (ngModelChange)="page = 1; load()">
          <option value="">All methods</option>
          <option *ngFor="let m of methods" [value]="m">{{ m | label }}</option>
        </select>
      </div>
      <div class="table-responsive">
        <table class="table table-app table-hover">
          <thead>
            <tr><th>When</th><th>Type</th><th>Method</th><th>Order</th><th class="text-end">Amount</th><th class="text-end">Tip</th><th class="text-end">Change</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            <ng-container *ngIf="loading()">
              <tr *ngFor="let _ of [1, 2, 3, 4]"><td colspan="9"><span class="skeleton" style="height: 18px"></span></td></tr>
            </ng-container>
            <ng-container *ngIf="!loading()">
              <tr *ngFor="let p of payments()">
                <td class="text-nowrap">{{ p.processedAt | tzDate: 'datetime' }}</td>
                <td>
                  <span class="pill" [class.pill-success]="p.type === 'payment'" [class.pill-warning]="p.type === 'refund'">{{ p.type | label }}</span>
                  <div *ngIf="p.note" class="text-muted text-2xs mt-1">{{ p.note }}</div>
                </td>
                <td>{{ p.method | label }}</td>
                <td><a [routerLink]="['/orders', p.orderId]" class="fw-medium">View order</a></td>
                <td class="text-end tabular fw-semibold" [class.text-danger]="p.type === 'refund'">{{ p.type === 'refund' ? '−' : '' }}{{ p.amount | money: p.currency }}</td>
                <td class="text-end tabular">{{ p.tipAmount ? (p.tipAmount | money: p.currency) : '—' }}</td>
                <td class="text-end tabular">{{ p.changeDue ? (p.changeDue | money: p.currency) : '—' }}</td>
                <td><span class="pill" [class.pill-success]="p.status === 'completed'" [class.pill-danger]="p.status === 'failed'">{{ p.status | label }}</span></td>
                <td class="row-actions">
                  <button *ngIf="canRefund() && p.type === 'payment' && p.status === 'completed' && refundable(p) > 0" type="button" class="btn btn-sm btn-light border" (click)="refundTarget = p">
                    Refund
                  </button>
                </td>
              </tr>
              <tr *ngIf="!payments().length"><td colspan="9"><div class="empty-state"><i class="bi bi-credit-card"></i>No payments in this period.</div></td></tr>
            </ng-container>
          </tbody>
        </table>
      </div>
      <app-pager [page]="page" [limit]="limit" [count]="payments().length" (pageChange)="page = $event; load()"></app-pager>
    </div>

    <app-refund-dialog
      [open]="!!refundTarget"
      [payment]="refundTarget"
      [refundable]="refundTarget ? refundable(refundTarget) : 0"
      (closed)="refundTarget = null"
      (refunded)="refundTarget = null; load()"
    ></app-refund-dialog>
  `,
})
export class PaymentsComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly methods = PAYMENT_METHODS;
  readonly limit = 50;
  readonly ranges: { value: Range; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: 'all', label: 'All' },
    { value: 'custom', label: 'Custom' },
  ];
  readonly loading = signal(true);
  readonly payments = signal<Payment[]>([]);
  /** Refunds are manager-only in the API. */
  readonly canRefund = computed(() => this.auth.hasRole('manager'));

  range: Range = 'today';
  method = '';
  fromDate = '';
  toDate = '';
  page = 1;
  refundTarget: Payment | null = null;

  /** Totals for the rows on this page. */
  readonly kpis = computed(() => {
    const done = this.payments().filter((p) => p.status === 'completed');
    const collected = done.filter((p) => p.type === 'payment').reduce((s, p) => s + p.amount, 0);
    const refunded = done.filter((p) => p.type === 'refund').reduce((s, p) => s + p.amount, 0);
    const tips = done.reduce((s, p) => s + (p.tipAmount || 0), 0);
    const cash = done.filter((p) => p.method === 'cash').reduce((s, p) => s + p.signedAmount, 0);
    return [
      { label: 'Collected', value: collected, hint: `${done.filter((p) => p.type === 'payment').length} payments`, negative: false },
      { label: 'Refunded', value: refunded, hint: `${done.filter((p) => p.type === 'refund').length} refunds`, negative: refunded > 0 },
      { label: 'Net', value: collected - refunded, hint: 'Collected minus refunds', negative: false },
      { label: 'Tips', value: tips, hint: `Cash net ${this.fmt(cash)}`, negative: false },
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  setRange(r: Range): void {
    this.range = r;
    this.page = 1;
    if (r !== 'custom') this.load();
  }

  load(): void {
    const { from, to } = this.bounds();
    this.loading.set(true);
    this.api
      .get<ApiList<Payment>>('/payments', { method: this.method, from, to, page: this.page, limit: this.limit })
      .subscribe({
        next: (res) => {
          this.payments.set(res.data);
          this.loading.set(false);
        },
        error: (err) => {
          this.toast.apiError(err);
          this.loading.set(false);
        },
      });
  }

  /** Date range in the restaurant's timezone, as ISO instants for `from` (inclusive) / `to` (exclusive). */
  private bounds(): { from?: string; to?: string } {
    const day = 864e5;
    const today = startOfTodayIn(this.auth.timezone()).getTime();
    switch (this.range) {
      case 'today':
        return { from: new Date(today).toISOString() };
      case 'yesterday':
        return { from: new Date(today - day).toISOString(), to: new Date(today).toISOString() };
      case '7d':
        return { from: new Date(today - 6 * day).toISOString() };
      case '30d':
        return { from: new Date(today - 29 * day).toISOString() };
      case 'custom':
        return {
          from: this.fromDate ? midnightIn(this.fromDate, this.auth.timezone()).toISOString() : undefined,
          to: this.toDate ? new Date(midnightIn(this.toDate, this.auth.timezone()).getTime() + day).toISOString() : undefined,
        };
      default:
        return {};
    }
  }

  /** Amount still refundable, based on refunds loaded on this page (the API re-checks it). */
  refundable(p: Payment): number {
    const done = this.payments()
      .filter((r) => r.type === 'refund' && r.refundOf === p.id && r.status === 'completed')
      .reduce((sum, r) => sum + r.amount, 0);
    return Math.max(p.amount - done, 0);
  }

  private fmt(cents: number): string {
    return new Intl.NumberFormat(this.auth.locale(), { style: 'currency', currency: this.auth.currency() }).format(cents / 100);
  }
}
