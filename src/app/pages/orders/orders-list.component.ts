import { DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, QueryParams } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ORDER_PAYMENT_STATUS, ORDER_STATUS, ORDER_TYPES } from '../../core/enums';
import { ApiList, Order, Table } from '../../core/models';
import { LabelPipe, MoneyPipe, TzDatePipe } from '../../core/pipes';
import { StaffDirectoryService } from '../../core/staff-directory.service';
import { ToastService } from '../../core/toast.service';
import { PagerComponent } from '../../shared/pager.component';
import { StatusPillComponent } from '../../shared/status-pill.component';

type SortKey = 'newest' | 'oldest' | 'total_desc' | 'total_asc' | 'waiter';

interface WaiterRow {
  userId: string;
  name: string;
  orders: number;
  open: number;
  items: number;
  sales: number;
  collected: number;
}

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [NgFor, NgIf, DecimalPipe, FormsModule, RouterLink, MoneyPipe, TzDatePipe, LabelPipe, StatusPillComponent, PagerComponent],
  template: `
    <div class="page-header">
      <div>
        <h1>Orders</h1>
        <p>Every ticket across dine-in, takeaway and delivery, with the waiter who took it.</p>
      </div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-light border" (click)="load()" [disabled]="loading()">
          <i class="bi bi-arrow-clockwise me-1"></i>Refresh
        </button>
        <a *ngIf="canTakeOrders()" routerLink="/pos" class="btn btn-primary"><i class="bi bi-plus-lg me-1"></i>New order</a>
      </div>
    </div>

    <div class="nav-tabs-app">
      <button type="button" [class.active]="tab === 'list'" (click)="setTab('list')"><i class="bi bi-list-ul me-1"></i>All orders</button>
      <button type="button" [class.active]="tab === 'waiters'" (click)="setTab('waiters')"><i class="bi bi-person-badge me-1"></i>Sales by waiter</button>
    </div>

    <div class="card">
      <div class="card-body border-bottom py-3">
        <div class="row g-2 align-items-end">
          <div class="col-6 col-md-2">
            <label class="form-label text-xs text-muted mb-1">Status</label>
            <select class="form-select form-select-sm" [(ngModel)]="status" (ngModelChange)="applyFilters()">
              <option value="">All statuses</option>
              <option *ngFor="let s of statuses" [value]="s">{{ s | label }}</option>
            </select>
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label text-xs text-muted mb-1">Payment</label>
            <select class="form-select form-select-sm" [(ngModel)]="paymentStatus" (ngModelChange)="applyFilters()">
              <option value="">All payments</option>
              <option *ngFor="let s of paymentStatuses" [value]="s">{{ s | label }}</option>
            </select>
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label text-xs text-muted mb-1">Type</label>
            <select class="form-select form-select-sm" [(ngModel)]="type" (ngModelChange)="applyFilters()">
              <option value="">All types</option>
              <option *ngFor="let t of types" [value]="t">{{ t | label }}</option>
            </select>
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label text-xs text-muted mb-1">Table</label>
            <select class="form-select form-select-sm" [(ngModel)]="tableId" (ngModelChange)="applyFilters()">
              <option value="">All tables</option>
              <option *ngFor="let t of tables()" [value]="t.id">{{ t.name }}</option>
            </select>
          </div>
          <div class="col-6 col-md-2" *ngIf="tab === 'list'">
            <label class="form-label text-xs text-muted mb-1">Waiter</label>
            <select class="form-select form-select-sm" [(ngModel)]="waiter" (ngModelChange)="applyFilters()">
              <option value="">All waiters</option>
              <option *ngFor="let s of directory.servers()" [value]="s.userId">{{ s.name }} ({{ s.role | label }})</option>
            </select>
          </div>
          <div class="col-6 col-md-2" *ngIf="tab === 'list'">
            <label class="form-label text-xs text-muted mb-1">Sort by</label>
            <select class="form-select form-select-sm" [(ngModel)]="sort" (ngModelChange)="applyFilters()">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="total_desc">Total: high to low</option>
              <option value="total_asc">Total: low to high</option>
              <option value="waiter">Waiter A–Z</option>
            </select>
          </div>
        </div>
      </div>

      <!-- ================= List ================= -->
      <ng-container *ngIf="tab === 'list'">
        <div class="table-responsive">
          <table class="table table-app table-hover">
            <thead>
              <tr>
                <th>Order</th>
                <th>Opened</th>
                <th>Waiter</th>
                <th>Type</th>
                <th class="text-center">Items</th>
                <th>Status</th>
                <th>Payment</th>
                <th class="text-end">Total</th>
                <th class="text-end">Balance</th>
              </tr>
            </thead>
            <tbody>
              <ng-container *ngIf="loading()">
                <tr *ngFor="let _ of [1, 2, 3, 4, 5, 6]"><td colspan="9"><span class="skeleton" style="height: 18px"></span></td></tr>
              </ng-container>
              <ng-container *ngIf="!loading()">
                <tr *ngFor="let o of pageRows()" class="clickable" (click)="open(o)">
                  <td class="fw-semibold">{{ o.orderNumber }}</td>
                  <td>{{ o.createdAt | tzDate: 'datetime' }}</td>
                  <td>
                    <span class="waiter-chip"><i class="bi bi-person"></i>{{ waiterName(o) }}</span>
                  </td>
                  <td>
                    <div>{{ o.type | label }}</div>
                    <div class="text-muted text-xs" *ngIf="tableName(o) as t">Table {{ t }} · {{ o.guestCount }} guests</div>
                    <div class="text-muted text-xs" *ngIf="!tableName(o) && o.customer?.name">{{ o.customer?.name }}</div>
                  </td>
                  <td class="text-center tabular">{{ itemCount(o) }}</td>
                  <td><app-status-pill [status]="o.status"></app-status-pill></td>
                  <td><app-status-pill [status]="o.paymentStatus"></app-status-pill></td>
                  <td class="text-end fw-semibold tabular">{{ o.grandTotal | money: o.currency }}</td>
                  <td class="text-end tabular" [class.text-danger]="(o.balanceDue ?? 0) > 0 && o.status !== 'cancelled'">
                    {{ o.balanceDue ?? 0 | money: o.currency }}
                  </td>
                </tr>
                <tr *ngIf="!pageRows().length">
                  <td colspan="9">
                    <div class="empty-state"><i class="bi bi-receipt"></i>No orders match these filters.</div>
                  </td>
                </tr>
              </ng-container>
            </tbody>
          </table>
        </div>
        <app-pager
          [page]="page"
          [limit]="limit"
          [count]="pageRows().length"
          [total]="clientMode() ? allRows().length : null"
          (pageChange)="goTo($event)"
        ></app-pager>
      </ng-container>

      <!-- ================= By waiter ================= -->
      <ng-container *ngIf="tab === 'waiters'">
        <div class="table-responsive">
          <table class="table table-app table-hover">
            <thead>
              <tr>
                <th>Waiter</th>
                <th class="text-center">Orders</th>
                <th class="text-center">Open now</th>
                <th class="text-center">Items sold</th>
                <th class="text-end">Sales</th>
                <th class="text-end">Collected</th>
                <th class="text-end">Avg. order</th>
                <th style="width: 22%">Share</th>
              </tr>
            </thead>
            <tbody>
              <ng-container *ngIf="loading()">
                <tr *ngFor="let _ of [1, 2, 3]"><td colspan="8"><span class="skeleton" style="height: 18px"></span></td></tr>
              </ng-container>
              <ng-container *ngIf="!loading()">
                <tr *ngFor="let w of waiterRows()" class="clickable" (click)="showWaiter(w)">
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <span class="avatar">{{ initials(w.name) }}</span>
                      <span class="fw-semibold">{{ w.name }}</span>
                      <span *ngIf="directory.isMe(w.userId)" class="text-muted text-xs">(you)</span>
                    </div>
                  </td>
                  <td class="text-center tabular">{{ w.orders }}</td>
                  <td class="text-center tabular">{{ w.open }}</td>
                  <td class="text-center tabular">{{ w.items }}</td>
                  <td class="text-end tabular fw-semibold">{{ w.sales | money }}</td>
                  <td class="text-end tabular">{{ w.collected | money }}</td>
                  <td class="text-end tabular">{{ (w.orders ? w.sales / w.orders : 0) | money }}</td>
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="progress flex-grow-1" style="height: 6px"><div class="progress-bar" [style.width.%]="share(w)"></div></div>
                      <span class="text-muted text-xs tabular" style="width: 36px">{{ share(w) | number: '1.0-0' }}%</span>
                    </div>
                  </td>
                </tr>
                <tr *ngIf="!waiterRows().length">
                  <td colspan="8"><div class="empty-state"><i class="bi bi-person-badge"></i>No orders match these filters.</div></td>
                </tr>
              </ng-container>
            </tbody>
            <tfoot *ngIf="!loading() && waiterRows().length">
              <tr class="fw-semibold">
                <td>Total</td>
                <td class="text-center tabular">{{ waiterTotals().orders }}</td>
                <td class="text-center tabular">{{ waiterTotals().open }}</td>
                <td class="text-center tabular">{{ waiterTotals().items }}</td>
                <td class="text-end tabular">{{ waiterTotals().sales | money }}</td>
                <td class="text-end tabular">{{ waiterTotals().collected | money }}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="px-3 py-2 border-top text-muted text-xs">Sales exclude cancelled orders. Click a waiter to see their orders.</div>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .waiter-chip {
        display: inline-flex; align-items: center; gap: 0.35rem;
        padding: 0.2rem 0.55rem; border-radius: 999px; background: #f1f5f9; color: #334155;
        font-size: 0.78rem; font-weight: 500; white-space: nowrap;
      }
      .avatar {
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; border-radius: 50%; background: #eaf0fc; color: var(--bs-primary);
        font-size: 0.72rem; font-weight: 600;
      }
      tfoot td { background: #f8fafc; border-top: 1px solid var(--app-border); }
    `,
  ],
})
export class OrdersListComponent implements OnInit {
  auth = inject(AuthService);
  directory = inject(StaffDirectoryService);
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);

  readonly statuses = ORDER_STATUS;
  readonly paymentStatuses = ORDER_PAYMENT_STATUS;
  readonly types = ORDER_TYPES;
  readonly limit = 20;

  readonly loading = signal(true);
  /** Server page (normal mode) or every matching order (waiter filter / custom sort / summary). */
  readonly rows = signal<Order[]>([]);
  readonly clientMode = signal(false);
  readonly tables = signal<Table[]>([]);
  readonly canTakeOrders = computed(() => this.auth.hasRole('manager', 'cashier', 'waiter'));

  tab: 'list' | 'waiters' = 'list';
  status = '';
  paymentStatus = '';
  type = '';
  tableId = '';
  waiter = '';
  sort: SortKey = 'newest';
  page = 1;

  /** All matching rows after the waiter filter and sort (client mode only). */
  readonly allRows = signal<Order[]>([]);

  readonly pageRows = computed(() => {
    if (!this.clientMode()) return this.rows();
    const start = (this.pageSig() - 1) * this.limit;
    return this.allRows().slice(start, start + this.limit);
  });
  private readonly pageSig = signal(1);

  readonly waiterRows = computed<WaiterRow[]>(() => {
    const map = new Map<string, WaiterRow>();
    for (const o of this.rows()) {
      if (o.status === 'cancelled') continue;
      const id = this.directory.waiterOf(o) ?? 'unknown';
      const row = map.get(id) ?? { userId: id, name: this.directory.name(id), orders: 0, open: 0, items: 0, sales: 0, collected: 0 };
      row.orders++;
      if (o.status !== 'completed') row.open++;
      row.items += this.itemCount(o);
      row.sales += o.grandTotal;
      row.collected += o.amountPaid - o.amountRefunded;
      map.set(id, row);
    }
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  });

  readonly waiterTotals = computed(() =>
    this.waiterRows().reduce(
      (t, w) => ({ orders: t.orders + w.orders, open: t.open + w.open, items: t.items + w.items, sales: t.sales + w.sales, collected: t.collected + w.collected }),
      { orders: 0, open: 0, items: 0, sales: 0, collected: 0 }
    )
  );

  ngOnInit(): void {
    this.directory.load();
    this.api.getAll<Table>('/tables').subscribe({ next: (t) => this.tables.set(t), error: () => undefined });
    this.load();
  }

  setTab(tab: 'list' | 'waiters'): void {
    this.tab = tab;
    this.applyFilters();
  }

  applyFilters(): void {
    this.page = 1;
    this.pageSig.set(1);
    this.load();
  }

  goTo(page: number): void {
    this.page = page;
    this.pageSig.set(page);
    if (!this.clientMode()) this.load();
  }

  /**
   * The API filters by status, payment, type and table only. Filtering by waiter, sorting and the
   * per-waiter summary need every matching order, so those load all pages and work in the browser.
   */
  load(): void {
    const query: QueryParams = { status: this.status, paymentStatus: this.paymentStatus, type: this.type, tableId: this.tableId };
    const client = this.tab === 'waiters' || !!this.waiter || this.sort !== 'newest';
    this.clientMode.set(client);
    this.loading.set(true);

    if (!client) {
      this.api.get<ApiList<Order>>('/orders', { ...query, page: this.page, limit: this.limit }).subscribe({
        next: (res) => this.done(res.data),
        error: (err) => this.fail(err),
      });
      return;
    }

    this.api.getAll<Order>('/orders', query).subscribe({
      next: (list) => {
        this.done(list);
        const filtered = this.waiter && this.tab === 'list' ? list.filter((o) => this.directory.waiterOf(o) === this.waiter) : list;
        this.allRows.set(this.sorted(filtered));
      },
      error: (err) => this.fail(err),
    });
  }

  showWaiter(w: WaiterRow): void {
    this.tab = 'list';
    this.waiter = w.userId === 'unknown' ? '' : w.userId;
    this.applyFilters();
  }

  open(o: Order): void {
    this.router.navigate(['/orders', o.id]);
  }

  waiterName(o: Order): string {
    const id = this.directory.waiterOf(o);
    return this.directory.isMe(id) ? `${this.directory.name(id)} (you)` : this.directory.name(id);
  }

  share(w: WaiterRow): number {
    const total = this.waiterTotals().sales;
    return total ? (w.sales / total) * 100 : 0;
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  tableName(o: Order): string {
    const t = o.tableId;
    if (!t) return '';
    if (typeof t === 'object') return t.name;
    return this.tables().find((x) => x.id === t)?.name ?? '';
  }

  itemCount(o: Order): number {
    return o.items.filter((i) => i.status !== 'cancelled').reduce((n, i) => n + i.quantity, 0);
  }

  private sorted(list: Order[]): Order[] {
    const copy = [...list];
    switch (this.sort) {
      case 'oldest':
        return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      case 'total_desc':
        return copy.sort((a, b) => b.grandTotal - a.grandTotal);
      case 'total_asc':
        return copy.sort((a, b) => a.grandTotal - b.grandTotal);
      case 'waiter':
        return copy.sort(
          (a, b) => this.directory.name(this.directory.waiterOf(a)).localeCompare(this.directory.name(this.directory.waiterOf(b))) || b.createdAt.localeCompare(a.createdAt)
        );
      default:
        return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }

  private done(list: Order[]): void {
    this.rows.set(list);
    this.loading.set(false);
  }

  private fail(err: unknown): void {
    this.toast.apiError(err);
    this.loading.set(false);
  }
}
