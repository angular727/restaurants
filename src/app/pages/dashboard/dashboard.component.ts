import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ACTIVE_ORDER_STATUS, TABLE_STATUS, TableStatus } from '../../core/enums';
import { formatDate, startOfTodayIn } from '../../core/format';
import { ApiList, InventoryItem, Order, Payment, Table } from '../../core/models';
import { LabelPipe, MoneyPipe, TzDatePipe } from '../../core/pipes';
import { StatusPillComponent } from '../../shared/status-pill.component';

interface LowStockRow extends InventoryItem {
  _id?: string;
}

interface DashboardData {
  tables: Table[] | null;
  activeOrders: Order[] | null;
  recentOrders: Order[] | null;
  lowStock: LowStockRow[] | null;
  paymentsToday: Payment[] | null;
}

const TABLE_BAR_COLORS: Record<TableStatus, string> = {
  available: '#15803d',
  occupied: '#2b59c3',
  reserved: '#b45309',
  cleaning: '#0e7490',
  out_of_service: '#94a3b8',
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, RouterLink, MoneyPipe, TzDatePipe, LabelPipe, StatusPillComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);

  readonly loading = signal(true);
  readonly data = signal<DashboardData | null>(null);
  readonly canSeePayments = computed(() => this.auth.hasRole('manager', 'cashier'));
  readonly canTakeOrders = computed(() => this.auth.hasRole('manager', 'cashier', 'waiter'));
  readonly canSeeKitchen = computed(() => this.auth.hasRole('manager', 'chef', 'waiter'));

  readonly greeting = computed(() => {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: this.auth.timezone() }).format(new Date())
    );
    const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const first = this.auth.user()?.name?.split(' ')[0];
    return first ? `${part}, ${first}` : part;
  });

  readonly today = computed(() =>
    new Intl.DateTimeFormat(this.auth.locale(), { dateStyle: 'full', timeZone: this.auth.timezone() }).format(new Date())
  );

  // ---- KPIs ------------------------------------------------------------------
  readonly collectedToday = computed(() =>
    (this.data()?.paymentsToday ?? []).filter((p) => p.status === 'completed').reduce((sum, p) => sum + p.signedAmount, 0)
  );
  readonly paymentCountToday = computed(
    () => (this.data()?.paymentsToday ?? []).filter((p) => p.status === 'completed' && p.type === 'payment').length
  );
  readonly activeOrderCount = computed(() => this.data()?.activeOrders?.length ?? 0);
  readonly openBalance = computed(() =>
    (this.data()?.activeOrders ?? []).reduce((sum, o) => sum + Math.max(o.grandTotal - (o.amountPaid - o.amountRefunded), 0), 0)
  );
  readonly activeTables = computed(() => (this.data()?.tables ?? []).filter((t) => t.isActive));
  readonly occupiedCount = computed(() => this.activeTables().filter((t) => t.status === 'occupied').length);
  readonly occupancyPct = computed(() => {
    const total = this.activeTables().length;
    return total ? Math.round((this.occupiedCount() / total) * 100) : 0;
  });
  readonly lowStockCount = computed(() => this.data()?.lowStock?.length ?? 0);

  readonly tableBreakdown = computed(() => {
    const tables = this.activeTables();
    return TABLE_STATUS.map((status) => {
      const count = tables.filter((t) => t.status === status).length;
      return { status, count, pct: tables.length ? (count / tables.length) * 100 : 0, color: TABLE_BAR_COLORS[status] };
    });
  });

  readonly ordersByStatus = computed(() => {
    const orders = this.data()?.activeOrders ?? [];
    return ACTIVE_ORDER_STATUS.map((status) => ({ status, count: orders.filter((o) => o.status === status).length }));
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    const list = <T>(path: string, query?: Record<string, string | number>) =>
      this.api.get<ApiList<T>>(path, query).pipe(
        map((r) => r.data),
        catchError(() => of(null))
      );

    const activeOrders: Observable<Order[] | null> = forkJoin(
      ACTIVE_ORDER_STATUS.map((status) => list<Order>('/orders', { status, limit: 100 }))
    ).pipe(map((groups) => (groups.every((g) => g === null) ? null : groups.flatMap((g) => g ?? []))));

    const paymentsToday = this.canSeePayments()
      ? list<Payment>('/payments', { from: startOfTodayIn(this.auth.timezone()).toISOString(), limit: 100 })
      : of(null);

    forkJoin({
      tables: list<Table>('/tables', { limit: 100 }),
      activeOrders,
      recentOrders: list<Order>('/orders', { limit: 8 }),
      lowStock: list<LowStockRow>('/inventory/items/low-stock'),
      paymentsToday,
    }).subscribe((data) => {
      this.data.set(data);
      this.loading.set(false);
    });
  }

  tableName(order: Order): string {
    const t = order.tableId;
    if (!t) return '';
    if (typeof t === 'object') return t.name;
    return this.data()?.tables?.find((x) => x.id === t)?.name ?? '';
  }

  itemCount(order: Order): number {
    return order.items.filter((i) => i.status !== 'cancelled').reduce((n, i) => n + i.quantity, 0);
  }

  stockPct(item: LowStockRow): number {
    if (!item.reorderLevel) return 0;
    return Math.max(0, Math.min(100, (item.currentStock / item.reorderLevel) * 100));
  }

  timeAgo(iso: string): string {
    return formatDate(iso, 'relative', this.auth.timezone(), this.auth.locale());
  }

  trackById(_: number, row: { id?: string; _id?: string }): string | undefined {
    return row.id ?? row._id;
  }
}
