import { DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ORDER_SOURCES, ORDER_TYPES, PAYMENT_METHODS, enumLabel } from '../../core/enums';
import { formatDate, formatMoney, formatQty } from '../../core/format';
import {
  InventoryItemFull,
  MenuCategory,
  MenuItem,
  Order,
  OrderItem,
  Payment,
  PurchaseOrder,
  StockMovement,
  Supplier,
  Table,
} from '../../core/models';
import { LabelPipe, MoneyPipe, TzDatePipe } from '../../core/pipes';
import { DateRange, RangeKey, buildRange, csvMoney, downloadCsv, inRange, zoned } from '../../core/report-utils';
import { StaffDirectoryService } from '../../core/staff-directory.service';
import { ToastService } from '../../core/toast.service';

type Tab = 'overview' | 'daily' | 'items' | 'lines' | 'orders' | 'tables' | 'staff' | 'time' | 'payments' | 'inventory' | 'purchasing';

interface Bar {
  label: string;
  value: number;
  sub?: string;
}

/** One sold order line with everything a report may group or filter by. */
interface LineRow {
  order: Order;
  line: OrderItem;
  at: string;
  date: string;
  hour: number;
  weekday: number;
  waiterId: string;
  tableId: string;
  tableName: string;
  section: string;
  menuItemId: string;
  name: string;
  categoryId: string;
  category: string;
  qty: number;
  price: number;
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
  /** Ingredient cost of this line (0 until it was sent to the kitchen). */
  cost: number;
}

export interface ReportFilters {
  waiter: string;
  table: string;
  section: string;
  type: string;
  source: string;
  status: '' | 'completed' | 'open';
  category: string;
  item: string;
  method: string;
  hourFrom: number;
  hourTo: number;
}

const EMPTY_FILTERS: ReportFilters = {
  waiter: '',
  table: '',
  section: '',
  type: '',
  source: '',
  status: '',
  category: '',
  item: '',
  method: '',
  hourFrom: 0,
  hourTo: 23,
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PAGE = 50;

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, DecimalPipe, FormsModule, RouterLink, MoneyPipe, TzDatePipe, LabelPipe],
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.scss'],
})
export class ReportsComponent implements OnInit {
  auth = inject(AuthService);
  directory = inject(StaffDirectoryService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Summary', icon: 'bi-graph-up' },
    { key: 'daily', label: 'Date-wise', icon: 'bi-calendar3' },
    { key: 'items', label: 'Item-wise', icon: 'bi-journal-text' },
    { key: 'lines', label: 'Item sales detail', icon: 'bi-list-check' },
    { key: 'orders', label: 'Orders register', icon: 'bi-receipt' },
    { key: 'tables', label: 'Table-wise', icon: 'bi-grid-3x3-gap' },
    { key: 'staff', label: 'Waiter-wise', icon: 'bi-person-badge' },
    { key: 'time', label: 'Hour & day', icon: 'bi-clock-history' },
    { key: 'payments', label: 'Payments & refunds', icon: 'bi-credit-card' },
    { key: 'inventory', label: 'Inventory & cost', icon: 'bi-box-seam' },
    { key: 'purchasing', label: 'Purchasing', icon: 'bi-clipboard-check' },
  ];
  readonly ranges: { key: RangeKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last7', label: '7 days' },
    { key: 'last30', label: '30 days' },
    { key: 'thisMonth', label: 'This month' },
    { key: 'lastMonth', label: 'Last month' },
    { key: 'custom', label: 'Custom' },
  ];
  readonly orderTypes = ORDER_TYPES;
  readonly orderSources = ORDER_SOURCES;
  readonly paymentMethods = PAYMENT_METHODS;
  readonly hours = Array.from({ length: 24 }, (_, h) => h);
  readonly fq = formatQty;

  readonly tab = signal<Tab>('overview');
  readonly range = signal<DateRange>(buildRange('last7', 'UTC'));
  customFrom = '';
  customTo = '';
  readonly filters = signal<ReportFilters>({ ...EMPTY_FILTERS });
  showFilters = true;

  readonly loading = signal(true);
  readonly generatedAt = signal<Date | null>(null);
  readonly allOrders = signal<Order[]>([]);
  readonly payments = signal<Payment[]>([]);
  readonly menuItems = signal<MenuItem[]>([]);
  readonly categories = signal<MenuCategory[]>([]);
  readonly tables = signal<Table[]>([]);

  readonly invLoading = signal(true);
  readonly invItems = signal<InventoryItemFull[]>([]);
  readonly movements = signal<(StockMovement & { itemName: string })[]>([]);
  readonly poLoading = signal(false);
  readonly purchaseOrders = signal<PurchaseOrder[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  private poLoaded = false;
  poSupplier = '';

  // Sorting & paging for the register tables
  readonly sort = signal<Record<string, { key: string; dir: 1 | -1 }>>({
    items: { key: 'net', dir: -1 },
    lines: { key: 'at', dir: -1 },
    orders: { key: 'at', dir: -1 },
    tables: { key: 'net', dir: -1 },
    staff: { key: 'net', dir: -1 },
    daily: { key: 'date', dir: 1 },
  });
  readonly linesPage = signal(1);
  readonly ordersPage = signal(1);
  readonly pageSize = PAGE;

  // ---- Lookups --------------------------------------------------------------------------
  readonly sections = computed(() => [...new Set(this.tables().map((t) => t.section || 'Main'))].sort());
  readonly itemOptions = computed(() => {
    const cat = this.filters().category;
    return this.menuItems()
      .filter((m) => !cat || m.categoryId === cat)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Unit cost per `${orderId}|${inventoryItemId}` from the sale movements (cents per base unit). */
  private readonly unitCosts = computed(() => {
    const m = new Map<string, number>();
    for (const mv of this.movements()) {
      if (mv.type === 'sale_deduction' && mv.reference?.id) m.set(`${mv.reference.id}|${mv.inventoryItemId}`, mv.unitCost || 0);
    }
    return m;
  });
  private readonly avgCosts = computed(() => new Map(this.invItems().map((i) => [i.id, i.averageCost ?? 0])));

  // ---- Filtering ----------------------------------------------------------------------------
  readonly activeFilters = computed(() => {
    const f = this.filters();
    const chips: { key: keyof ReportFilters; label: string }[] = [];
    if (f.waiter) chips.push({ key: 'waiter', label: `Waiter: ${this.directory.name(f.waiter)}` });
    if (f.section) chips.push({ key: 'section', label: `Section: ${f.section}` });
    if (f.table) chips.push({ key: 'table', label: `Table: ${this.tables().find((t) => t.id === f.table)?.name ?? '—'}` });
    if (f.type) chips.push({ key: 'type', label: `Type: ${enumLabel(f.type)}` });
    if (f.source) chips.push({ key: 'source', label: `Source: ${enumLabel(f.source)}` });
    if (f.status) chips.push({ key: 'status', label: `Status: ${enumLabel(f.status)}` });
    if (f.category) chips.push({ key: 'category', label: `Category: ${this.categories().find((c) => c.id === f.category)?.name ?? '—'}` });
    if (f.item) chips.push({ key: 'item', label: `Item: ${this.menuItems().find((m) => m.id === f.item)?.name ?? '—'}` });
    if (f.method) chips.push({ key: 'method', label: `Payment: ${enumLabel(f.method)}` });
    if (f.hourFrom !== 0 || f.hourTo !== 23) chips.push({ key: 'hourFrom', label: `Hours: ${this.hourLabel(f.hourFrom)}–${this.hourLabel(f.hourTo + 1)}` });
    return chips;
  });

  /** Item/category filters narrow the report to individual lines rather than whole orders. */
  readonly lineFilter = computed(() => !!this.filters().category || !!this.filters().item);

  private orderPasses(o: Order, f: ReportFilters, withStatus = true): boolean {
    if (!inRange(o.openedAt || o.createdAt, this.range())) return false;
    if (f.waiter && this.directory.waiterOf(o) !== f.waiter) return false;
    const tableId = this.tableIdOf(o);
    if (f.table && tableId !== f.table) return false;
    if (f.section && this.tableSection(tableId) !== f.section) return false;
    if (f.type && o.type !== f.type) return false;
    if (f.source && (o.source || 'pos') !== f.source) return false;
    if (withStatus && f.status === 'completed' && o.status !== 'completed') return false;
    if (withStatus && f.status === 'open' && ['completed', 'cancelled'].includes(o.status)) return false;
    if (f.hourFrom !== 0 || f.hourTo !== 23) {
      const h = zoned(o.openedAt || o.createdAt, this.auth.timezone()).hour;
      if (h < f.hourFrom || h > f.hourTo) return false;
    }
    return true;
  }

  private linePasses(line: OrderItem, f: ReportFilters): boolean {
    const id = String(line.menuItemId);
    if (f.item && id !== f.item) return false;
    if (f.category && this.menuItems().find((m) => m.id === id)?.categoryId !== f.category) return false;
    return true;
  }

  /** Non-cancelled orders passing the order-level filters. */
  private readonly baseOrders = computed(() => {
    const f = this.filters();
    return this.allOrders().filter((o) => o.status !== 'cancelled' && this.orderPasses(o, f));
  });

  /** Every sold line in scope. */
  readonly lines = computed<LineRow[]>(() => {
    const f = this.filters();
    const tz = this.auth.timezone();
    const costs = this.unitCosts();
    const avg = this.avgCosts();
    const rows: LineRow[] = [];
    for (const o of this.baseOrders()) {
      const at = o.openedAt || o.createdAt;
      const z = zoned(at, tz);
      const tableId = this.tableIdOf(o);
      for (const l of o.items) {
        if (l.status === 'cancelled' || !this.linePasses(l, f)) continue;
        const id = String(l.menuItemId);
        const menu = this.menuItems().find((m) => m.id === id);
        const discount = Math.min(l.discountAmount ?? 0, l.lineSubtotal);
        const cost = (l.inventoryConsumed ?? []).reduce(
          (s, c) => s + c.quantity * (costs.get(`${o.id}|${c.inventoryItemId}`) ?? avg.get(String(c.inventoryItemId)) ?? 0),
          0
        );
        rows.push({
          order: o,
          line: l,
          at,
          date: z.date,
          hour: z.hour,
          weekday: z.weekday,
          waiterId: this.directory.waiterOf(o) ?? '',
          tableId,
          tableName: this.tableName(tableId, o),
          section: this.tableSection(tableId),
          menuItemId: id,
          name: l.name,
          categoryId: menu?.categoryId ?? '',
          category: this.categoryName(menu?.categoryId),
          qty: l.quantity,
          price: l.unitPrice,
          gross: l.lineSubtotal,
          discount,
          net: l.lineSubtotal - discount,
          tax: l.taxAmount,
          total: l.lineTotal,
          cost: Math.round(cost),
        });
      }
    }
    return rows;
  });

  /** Orders in scope: those with at least one matching line when an item filter is on. */
  readonly scopedOrders = computed(() => {
    if (!this.lineFilter()) return this.baseOrders();
    const ids = new Set(this.lines().map((r) => r.order.id));
    return this.baseOrders().filter((o) => ids.has(o.id));
  });

  readonly cancelledOrders = computed(() => {
    const f = this.filters();
    return this.allOrders().filter((o) => o.status === 'cancelled' && this.orderPasses(o, f, false));
  });

  // ---- Summary ------------------------------------------------------------------------------
  readonly summary = computed(() => {
    const lines = this.lines();
    const orders = this.scopedOrders();
    const whole = !this.lineFilter();
    const sumL = (f: (r: LineRow) => number) => lines.reduce((s, r) => s + f(r), 0);
    const sumO = (f: (o: Order) => number) => orders.reduce((s, o) => s + f(o), 0);
    const gross = sumL((r) => r.gross);
    const discounts = sumL((r) => r.discount);
    const net = gross - discounts;
    const tax = sumL((r) => r.tax);
    const service = whole ? sumO((o) => o.serviceCharge) : 0;
    const total = sumL((r) => r.total) + service;
    const guests = orders.filter((o) => o.type === 'dine_in').reduce((s, o) => s + (o.guestCount || 0), 0);
    const cost = sumL((r) => r.cost);
    return {
      whole,
      orders: orders.length,
      completed: orders.filter((o) => o.status === 'completed').length,
      open: orders.filter((o) => o.status !== 'completed').length,
      cancelled: this.cancelledOrders().length,
      gross,
      discounts,
      net,
      tax,
      service,
      total,
      tips: whole ? sumO((o) => o.tipTotal) : 0,
      paid: whole ? sumO((o) => o.amountPaid - o.amountRefunded) : 0,
      refunded: whole ? sumO((o) => o.amountRefunded) : 0,
      outstanding: whole ? sumO((o) => o.balanceDue ?? 0) : 0,
      guests,
      items: sumL((r) => r.qty),
      avgCheck: orders.length ? total / orders.length : 0,
      perGuest: guests ? net / guests : 0,
      cost,
      profit: net - cost,
      margin: net ? ((net - cost) / net) * 100 : 0,
    };
  });

  readonly dailyTrend = computed<Bar[]>(() =>
    this.dailyRows()
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ label: this.shortDate(d.date), value: d.net, sub: `${d.orders} orders` }))
  );

  readonly byType = computed(() => this.groupLines((r) => r.order.type, (k) => enumLabel(k)));
  readonly bySource = computed(() =>
    this.groupLines((r) => r.order.source || 'pos', (k) => (k === 'pos' ? 'Counter / POS' : k === 'qr' ? 'QR code' : enumLabel(k)))
  );

  // ---- Date-wise ----------------------------------------------------------------------------
  readonly dailyRows = computed(() => {
    const map = new Map<string, { date: string; orders: Set<string>; guests: number; items: number; gross: number; discount: number; net: number; tax: number; total: number; cost: number; service: number; tips: number }>();
    for (const d of this.range().days) {
      map.set(d, { date: d, orders: new Set(), guests: 0, items: 0, gross: 0, discount: 0, net: 0, tax: 0, total: 0, cost: 0, service: 0, tips: 0 });
    }
    for (const r of this.lines()) {
      const row = map.get(r.date);
      if (!row) continue;
      if (!row.orders.has(r.order.id)) {
        row.orders.add(r.order.id);
        if (r.order.type === 'dine_in') row.guests += r.order.guestCount || 0;
        if (!this.lineFilter()) {
          row.service += r.order.serviceCharge;
          row.tips += r.order.tipTotal;
        }
      }
      row.items += r.qty;
      row.gross += r.gross;
      row.discount += r.discount;
      row.net += r.net;
      row.tax += r.tax;
      row.total += r.total;
      row.cost += r.cost;
    }
    const rows = [...map.values()].map((r) => ({
      ...r,
      orders: r.orders.size,
      total: r.total + r.service,
      avg: r.orders.size ? (r.total + r.service) / r.orders.size : 0,
      profit: r.net - r.cost,
    }));
    return this.sorted('daily', rows);
  });

  readonly dailyTotals = computed(() => this.totalsOf(this.dailyRows(), ['orders', 'guests', 'items', 'gross', 'discount', 'net', 'tax', 'service', 'total', 'tips', 'cost', 'profit']));

  // ---- Item-wise ----------------------------------------------------------------------------
  readonly itemRows = computed(() => {
    const map = new Map<string, { id: string; name: string; category: string; qty: number; orders: Set<string>; gross: number; discount: number; net: number; cost: number }>();
    for (const r of this.lines()) {
      const row = map.get(r.menuItemId) ?? { id: r.menuItemId, name: r.name, category: r.category, qty: 0, orders: new Set<string>(), gross: 0, discount: 0, net: 0, cost: 0 };
      row.qty += r.qty;
      row.orders.add(r.order.id);
      row.gross += r.gross;
      row.discount += r.discount;
      row.net += r.net;
      row.cost += r.cost;
      map.set(r.menuItemId, row);
    }
    const total = [...map.values()].reduce((s, r) => s + r.net, 0);
    const rows = [...map.values()].map((r) => ({
      ...r,
      orders: r.orders.size,
      avgPrice: r.qty ? r.net / r.qty : 0,
      profit: r.net - r.cost,
      margin: r.net ? ((r.net - r.cost) / r.net) * 100 : 0,
      share: total ? (r.net / total) * 100 : 0,
    }));
    return this.sorted('items', rows);
  });

  readonly itemTotals = computed(() => this.totalsOf(this.itemRows(), ['qty', 'gross', 'discount', 'net', 'cost', 'profit']));

  readonly categoryRows = computed(() => {
    const map = new Map<string, { name: string; qty: number; net: number; cost: number }>();
    for (const r of this.lines()) {
      const row = map.get(r.category) ?? { name: r.category, qty: 0, net: 0, cost: 0 };
      row.qty += r.qty;
      row.net += r.net;
      row.cost += r.cost;
      map.set(r.category, row);
    }
    const total = [...map.values()].reduce((s, r) => s + r.net, 0);
    return [...map.values()].map((r) => ({ ...r, share: total ? (r.net / total) * 100 : 0 })).sort((a, b) => b.net - a.net);
  });

  readonly voids = computed(() => {
    const f = this.filters();
    const rows: { order: Order; name: string; qty: number; value: number; reason: string; waiter: string; table: string }[] = [];
    for (const o of this.allOrders()) {
      if (!this.orderPasses(o, f, false)) continue;
      for (const l of o.items) {
        if (l.status !== 'cancelled' || !this.linePasses(l, f)) continue;
        rows.push({
          order: o,
          name: l.name,
          qty: l.quantity,
          value: l.unitPrice * l.quantity,
          reason: l.cancelReason || o.cancelReason || '',
          waiter: this.directory.name(this.directory.waiterOf(o)),
          table: this.tableName(this.tableIdOf(o), o),
        });
      }
    }
    return rows.sort((a, b) => b.value - a.value);
  });
  readonly voidTotal = computed(() => this.voids().reduce((s, v) => s + v.value, 0));

  // ---- Line & order registers ------------------------------------------------------------------
  readonly lineRegister = computed(() => this.sorted('lines', this.lines()));
  readonly linePage = computed(() => this.lineRegister().slice((this.linesPage() - 1) * PAGE, this.linesPage() * PAGE));

  readonly orderRegister = computed(() => {
    const byOrder = new Map<string, { qty: number; net: number; cost: number }>();
    for (const r of this.lines()) {
      const row = byOrder.get(r.order.id) ?? { qty: 0, net: 0, cost: 0 };
      row.qty += r.qty;
      row.net += r.net;
      row.cost += r.cost;
      byOrder.set(r.order.id, row);
    }
    const rows = this.scopedOrders().map((o) => {
      const tableId = this.tableIdOf(o);
      const agg = byOrder.get(o.id) ?? { qty: 0, net: 0, cost: 0 };
      return {
        order: o,
        at: o.openedAt || o.createdAt,
        number: o.orderNumber,
        type: o.type,
        table: this.tableName(tableId, o),
        waiter: this.directory.name(this.directory.waiterOf(o)),
        guests: o.guestCount || 0,
        items: agg.qty,
        net: agg.net,
        total: o.grandTotal,
        paid: o.amountPaid - o.amountRefunded,
        balance: o.balanceDue ?? 0,
        status: o.status,
        payment: o.paymentStatus,
        minutes: o.completedAt ? Math.round((new Date(o.completedAt).getTime() - new Date(o.openedAt || o.createdAt).getTime()) / 60000) : null,
      };
    });
    return this.sorted('orders', rows);
  });
  readonly orderPage = computed(() => this.orderRegister().slice((this.ordersPage() - 1) * PAGE, this.ordersPage() * PAGE));

  // ---- Table-wise --------------------------------------------------------------------------------
  readonly tableRows = computed(() => {
    const map = new Map<string, { id: string; name: string; section: string; orders: Set<string>; guests: number; items: number; net: number; total: number; minutes: number[] }>();
    for (const r of this.lines()) {
      const key = r.tableId || `__${r.order.type}`;
      const row =
        map.get(key) ??
        { id: key, name: r.tableId ? r.tableName : enumLabel(r.order.type) + ' (no table)', section: r.tableId ? r.section : '—', orders: new Set<string>(), guests: 0, items: 0, net: 0, total: 0, minutes: [] as number[] };
      if (!row.orders.has(r.order.id)) {
        row.orders.add(r.order.id);
        row.guests += r.order.type === 'dine_in' ? r.order.guestCount || 0 : 0;
        if (r.order.completedAt) row.minutes.push((new Date(r.order.completedAt).getTime() - new Date(r.at).getTime()) / 60000);
      }
      row.items += r.qty;
      row.net += r.net;
      row.total += r.total;
      map.set(key, row);
    }
    const net = [...map.values()].reduce((s, r) => s + r.net, 0);
    const rows = [...map.values()].map((r) => ({
      ...r,
      orders: r.orders.size,
      avg: r.orders.size ? r.total / r.orders.size : 0,
      perGuest: r.guests ? r.net / r.guests : 0,
      avgMinutes: r.minutes.length ? Math.round(r.minutes.reduce((a, b) => a + b, 0) / r.minutes.length) : null,
      share: net ? (r.net / net) * 100 : 0,
    }));
    return this.sorted('tables', rows);
  });

  // ---- Waiter-wise --------------------------------------------------------------------------------
  readonly waiterRows = computed(() => {
    const map = new Map<string, { id: string; orders: Set<string>; guests: number; items: number; net: number; total: number; tips: number; cost: number }>();
    for (const r of this.lines()) {
      const id = r.waiterId || 'unknown';
      const row = map.get(id) ?? { id, orders: new Set<string>(), guests: 0, items: 0, net: 0, total: 0, tips: 0, cost: 0 };
      if (!row.orders.has(r.order.id)) {
        row.orders.add(r.order.id);
        row.guests += r.order.type === 'dine_in' ? r.order.guestCount || 0 : 0;
        if (!this.lineFilter()) row.tips += r.order.tipTotal || 0;
      }
      row.items += r.qty;
      row.net += r.net;
      row.total += r.total;
      row.cost += r.cost;
      map.set(id, row);
    }
    const net = [...map.values()].reduce((s, r) => s + r.net, 0);
    const rows = [...map.values()].map((r) => ({
      ...r,
      name: this.directory.name(r.id),
      orders: r.orders.size,
      avg: r.orders.size ? r.total / r.orders.size : 0,
      share: net ? (r.net / net) * 100 : 0,
    }));
    return this.sorted('staff', rows);
  });

  /** Waiter × item matrix: what each waiter sold. */
  readonly waiterItems = computed(() => {
    const map = new Map<string, Map<string, { name: string; qty: number; net: number }>>();
    for (const r of this.lines()) {
      const w = map.get(r.waiterId) ?? new Map();
      const row = w.get(r.menuItemId) ?? { name: r.name, qty: 0, net: 0 };
      row.qty += r.qty;
      row.net += r.net;
      w.set(r.menuItemId, row);
      map.set(r.waiterId, w);
    }
    return [...map.entries()]
      .map(([id, items]) => ({ id, name: this.directory.name(id), items: [...items.values()].sort((a, b) => b.net - a.net) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // ---- Hour & day ------------------------------------------------------------------------------------
  readonly hourly = computed<Bar[]>(() => {
    const rows = Array.from({ length: 24 }, (_, h) => ({ h, net: 0, orders: new Set<string>() }));
    for (const r of this.lines()) {
      rows[r.hour].net += r.net;
      rows[r.hour].orders.add(r.order.id);
    }
    return rows.map((r) => ({ label: this.hourLabel(r.h), value: r.net, sub: `${r.orders.size} orders` }));
  });

  readonly weekdays = computed<Bar[]>(() => {
    const rows = WEEKDAYS.map((d) => ({ d, net: 0, orders: new Set<string>() }));
    for (const r of this.lines()) {
      if (r.weekday < 0) continue;
      rows[r.weekday].net += r.net;
      rows[r.weekday].orders.add(r.order.id);
    }
    return rows.map((r) => ({ label: r.d.slice(0, 3), value: r.net, sub: `${r.orders.size} orders` }));
  });

  readonly busiestHour = computed(() => this.hourly().reduce((best, b) => (b.value > best.value ? b : best), { label: '—', value: 0 } as Bar));
  readonly busiestDay = computed(() => this.weekdays().reduce((best, b) => (b.value > best.value ? b : best), { label: '—', value: 0 } as Bar));

  // ---- Payments ----------------------------------------------------------------------------------------
  /** Payments for orders in scope (when an order filter is on) and of the chosen method. */
  readonly paymentsDone = computed(() => {
    const f = this.filters();
    const orderFilter = this.activeFilters().some((c) => c.key !== 'method');
    const ids = orderFilter ? new Set(this.scopedOrders().map((o) => o.id)) : null;
    return this.payments().filter((p) => p.status === 'completed' && (!f.method || p.method === f.method) && (!ids || ids.has(p.orderId)));
  });

  readonly byMethod = computed(() => {
    const map = new Map<string, { method: string; count: number; collected: number; refunds: number; refunded: number; tips: number }>();
    for (const p of this.paymentsDone()) {
      const row = map.get(p.method) ?? { method: p.method, count: 0, collected: 0, refunds: 0, refunded: 0, tips: 0 };
      if (p.type === 'payment') {
        row.count++;
        row.collected += p.amount;
        row.tips += p.tipAmount || 0;
      } else {
        row.refunds++;
        row.refunded += p.amount;
      }
      map.set(p.method, row);
    }
    return [...map.values()].map((r) => ({ ...r, net: r.collected - r.refunded })).sort((a, b) => b.net - a.net);
  });

  readonly paymentTotals = computed(() => this.totalsOf(this.byMethod(), ['count', 'collected', 'refunds', 'refunded', 'tips', 'net']));

  readonly cashDrawer = computed(() => {
    const cash = this.paymentsDone().filter((p) => p.method === 'cash');
    const pays = cash.filter((p) => p.type === 'payment');
    const sales = pays.reduce((s, p) => s + p.amount, 0);
    const tips = pays.reduce((s, p) => s + (p.tipAmount || 0), 0);
    const refunds = cash.filter((p) => p.type === 'refund').reduce((s, p) => s + p.amount, 0);
    return {
      sales,
      tips,
      refunds,
      tendered: cash.reduce((s, p) => s + (p.cashTendered || 0), 0),
      change: cash.reduce((s, p) => s + (p.changeDue || 0), 0),
      expected: sales + tips - refunds,
    };
  });

  readonly refunds = computed(() =>
    this.paymentsDone()
      .filter((p) => p.type === 'refund')
      .map((r) => ({
        refund: r,
        original: this.payments().find((p) => p.id === r.refundOf) ?? null,
        order: this.allOrders().find((o) => o.id === r.orderId) ?? null,
      }))
      .sort((a, b) => b.refund.processedAt.localeCompare(a.refund.processedAt))
  );

  readonly cashierRows = computed(() => {
    const map = new Map<string, { id: string; payments: number; collected: number; refunds: number; refunded: number }>();
    for (const p of this.paymentsDone()) {
      const id = p.processedBy ?? 'unknown';
      const row = map.get(id) ?? { id, payments: 0, collected: 0, refunds: 0, refunded: 0 };
      if (p.type === 'payment') {
        row.payments++;
        row.collected += p.amount;
      } else {
        row.refunds++;
        row.refunded += p.amount;
      }
      map.set(id, row);
    }
    return [...map.values()].map((r) => ({ ...r, name: this.directory.name(r.id) })).sort((a, b) => b.collected - a.collected);
  });

  // ---- Inventory & cost ------------------------------------------------------------------------------
  readonly movementsInRange = computed(() => this.movements().filter((m) => inRange(m.occurredAt, this.range())));

  readonly waste = computed(() => {
    const rows = this.movementsInRange()
      .filter((m) => m.type === 'waste')
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return { rows, total: rows.reduce((s, m) => s + Math.abs(m.totalCost || 0), 0) };
  });

  /** Ingredient usage from the lines in scope (follows every filter). */
  readonly consumption = computed(() => {
    const costs = this.unitCosts();
    const avg = this.avgCosts();
    const names = new Map(this.invItems().map((i) => [i.id, { name: i.name, unit: i.unit }]));
    const map = new Map<string, { name: string; unit: string; used: number; cost: number }>();
    for (const r of this.lines()) {
      for (const c of r.line.inventoryConsumed ?? []) {
        const id = String(c.inventoryItemId);
        const info = names.get(id) ?? { name: 'Deleted item', unit: '' };
        const row = map.get(id) ?? { name: info.name, unit: info.unit, used: 0, cost: 0 };
        row.used += c.quantity;
        row.cost += c.quantity * (costs.get(`${r.order.id}|${id}`) ?? avg.get(id) ?? 0);
        map.set(id, row);
      }
    }
    return [...map.values()].map((r) => ({ ...r, cost: Math.round(r.cost) })).sort((a, b) => b.cost - a.cost);
  });

  readonly stock = computed(() => {
    const active = this.invItems().filter((i) => i.isActive);
    return {
      items: active.length,
      value: active.reduce((s, i) => s + (i.stockValue ?? 0), 0),
      byValue: [...active].sort((a, b) => (b.stockValue ?? 0) - (a.stockValue ?? 0)),
    };
  });

  // ---- Purchasing ------------------------------------------------------------------------------------------
  readonly posInRange = computed(() =>
    this.purchaseOrders().filter((po) => inRange(po.createdAt, this.range()) && (!this.poSupplierSig() || this.supplierIdOf(po) === this.poSupplierSig()))
  );
  readonly poSupplierSig = signal('');

  readonly purchasing = computed(() => {
    const live = this.posInRange().filter((po) => po.status !== 'cancelled');
    const received = (po: PurchaseOrder) => po.items.reduce((s, l) => s + Math.round(l.quantityReceived * l.unitCost), 0);
    const outstanding = this.purchaseOrders().filter(
      (po) => ['submitted', 'partially_received'].includes(po.status) && (!this.poSupplierSig() || this.supplierIdOf(po) === this.poSupplierSig())
    );
    return {
      count: live.length,
      ordered: live.reduce((s, po) => s + po.grandTotal, 0),
      received: live.reduce((s, po) => s + received(po), 0),
      drafts: live.filter((po) => po.status === 'draft').length,
      outstanding,
      outstandingValue: outstanding.reduce((s, po) => s + po.items.reduce((x, l) => x + Math.round(l.quantityOutstanding * l.unitCost), 0), 0),
    };
  });

  readonly bySupplier = computed(() => {
    const map = new Map<string, { name: string; orders: number; ordered: number; received: number }>();
    for (const po of this.posInRange()) {
      if (po.status === 'cancelled') continue;
      const id = this.supplierIdOf(po);
      const row = map.get(id) ?? { name: this.supplierName(po), orders: 0, ordered: 0, received: 0 };
      row.orders++;
      row.ordered += po.grandTotal;
      row.received += po.items.reduce((s, l) => s + Math.round(l.quantityReceived * l.unitCost), 0);
      map.set(id, row);
    }
    return [...map.values()].sort((a, b) => b.ordered - a.ordered);
  });

  readonly purchasedItems = computed(() => {
    const map = new Map<string, { name: string; unit: string; qty: number; received: number; value: number }>();
    for (const po of this.posInRange()) {
      if (po.status === 'cancelled') continue;
      for (const l of po.items) {
        const row = map.get(l.inventoryItemId) ?? { name: l.itemName, unit: l.purchaseUnit, qty: 0, received: 0, value: 0 };
        row.qty += l.quantityOrdered;
        row.received += l.quantityReceived;
        row.value += l.lineTotal;
        map.set(l.inventoryItemId, row);
      }
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  });

  // ---- Lifecycle ----------------------------------------------------------------------------------------------
  ngOnInit(): void {
    this.directory.load();
    this.range.set(buildRange('last7', this.auth.timezone()));
    forkJoin({
      menu: this.api.getAll<MenuItem>('/menu/items').pipe(catchError(() => of([] as MenuItem[]))),
      cats: this.api.getAll<MenuCategory>('/menu/categories').pipe(catchError(() => of([] as MenuCategory[]))),
      tables: this.api.getAll<Table>('/tables').pipe(catchError(() => of([] as Table[]))),
    }).subscribe(({ menu, cats, tables }) => {
      this.menuItems.set(menu);
      this.categories.set(cats);
      this.tables.set(tables);
    });
    this.load();
    this.loadInventory();
  }

  setRange(key: RangeKey): void {
    if (key === 'custom') {
      const r = this.range();
      this.customFrom ||= r.days[0];
      this.customTo ||= r.days[r.days.length - 1];
    }
    this.range.set(buildRange(key, this.auth.timezone(), this.customFrom, this.customTo));
    this.resetPages();
    this.load();
  }

  applyCustom(): void {
    this.range.set(buildRange('custom', this.auth.timezone(), this.customFrom, this.customTo));
    this.resetPages();
    this.load();
  }

  setFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]): void {
    this.filters.update((f) => {
      const next = { ...f, [key]: value };
      if (key === 'category' && next.item && this.menuItems().find((m) => m.id === next.item)?.categoryId !== value) next.item = '';
      if (key === 'section' && next.table && this.tableSection(next.table) !== value) next.table = '';
      if (key === 'hourFrom' && next.hourTo < Number(value)) next.hourTo = Number(value);
      if (key === 'hourTo' && next.hourFrom > Number(value)) next.hourFrom = Number(value);
      return next;
    });
    this.resetPages();
  }

  clearFilter(key: keyof ReportFilters): void {
    if (key === 'hourFrom' || key === 'hourTo') {
      this.filters.update((f) => ({ ...f, hourFrom: 0, hourTo: 23 }));
    } else {
      this.setFilter(key, EMPTY_FILTERS[key]);
    }
  }

  clearFilters(): void {
    this.filters.set({ ...EMPTY_FILTERS });
    this.resetPages();
  }

  /** Jump from a summary row to a filtered view (drill-down). */
  drill(key: keyof ReportFilters, value: string, tab: Tab = 'lines'): void {
    if (!value || value === 'unknown' || value.startsWith('__')) return;
    this.setFilter(key, value as never);
    this.setTab(tab);
  }

  setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'purchasing') this.loadPurchasing();
  }

  sortBy(table: string, key: string): void {
    this.sort.update((s) => {
      const cur = s[table];
      const dir: 1 | -1 = cur?.key === key ? (cur.dir === 1 ? -1 : 1) : ['name', 'number', 'table', 'waiter', 'category', 'date', 'section'].includes(key) ? 1 : -1;
      return { ...s, [table]: { key, dir } };
    });
  }

  sortIcon(table: string, key: string): string {
    const s = this.sort()[table];
    if (s?.key !== key) return 'bi-arrow-down-up text-muted opacity-50';
    return s.dir === 1 ? 'bi-sort-up' : 'bi-sort-down';
  }

  load(): void {
    const r = this.range();
    this.loading.set(true);
    forkJoin({
      orders: this.api.getAll<Order>('/orders'),
      payments: this.api.getAll<Payment>('/payments', { from: r.from.toISOString(), to: r.to.toISOString() }),
    }).subscribe({
      next: ({ orders, payments }) => {
        this.allOrders.set(orders);
        this.payments.set(payments);
        this.generatedAt.set(new Date());
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err, 'Could not load report data');
        this.loading.set(false);
      },
    });
  }

  refresh(): void {
    this.load();
    this.loadInventory();
    if (this.poLoaded) this.loadPurchasing(true);
  }

  /** Stock ledgers are per item in the API; they give exact ingredient costs for each sold line. */
  loadInventory(): void {
    this.invLoading.set(true);
    this.api.getAll<InventoryItemFull>('/inventory/items').subscribe({
      next: (items) => {
        this.invItems.set(items);
        if (!items.length) {
          this.movements.set([]);
          this.invLoading.set(false);
          return;
        }
        forkJoin(
          items.map((i) =>
            this.api.getAll<StockMovement>(`/inventory/items/${i.id}/movements`).pipe(
              map((list) => list.map((m) => ({ ...m, itemName: i.name }))),
              catchError(() => of([] as (StockMovement & { itemName: string })[]))
            )
          )
        ).subscribe((groups) => {
          this.movements.set(groups.flat());
          this.invLoading.set(false);
        });
      },
      error: () => this.invLoading.set(false),
    });
  }

  loadPurchasing(force = false): void {
    if (this.poLoading() || (!force && this.poLoaded)) return;
    this.poLoading.set(true);
    forkJoin({
      pos: this.api.getAll<PurchaseOrder>('/purchase-orders'),
      suppliers: this.api.getAll<Supplier>('/suppliers'),
    }).subscribe({
      next: ({ pos, suppliers }) => {
        this.purchaseOrders.set(pos);
        this.suppliers.set(suppliers);
        this.poLoaded = true;
        this.poLoading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err);
        this.poLoading.set(false);
      },
    });
  }

  print(): void {
    window.print();
  }

  tabLabel(): string {
    return this.tabs.find((t) => t.key === this.tab())?.label ?? 'Reports';
  }

  filterSummary(): string {
    const chips = this.activeFilters();
    return chips.length ? chips.map((c) => c.label).join(' · ') : 'No filters';
  }

  // ---- CSV exports -------------------------------------------------------------------------------------------
  private file(name: string): string {
    const r = this.range();
    return `${name}_${r.days[0]}_to_${r.days[r.days.length - 1]}.csv`;
  }

  private meta(): (string | number)[][] {
    return [['Restaurant', this.auth.tenant()?.name ?? ''], ['Period', this.range().label], ['Filters', this.filterSummary()], []];
  }

  exportSummary(): void {
    const s = this.summary();
    downloadCsv(this.file('sales-summary'), ['Metric', 'Value'], [
      ...this.meta(),
      ['Orders', s.orders], ['Completed', s.completed], ['Open', s.open], ['Cancelled orders', s.cancelled],
      ['Items sold', s.items], ['Guests (dine-in)', s.guests],
      ['Gross sales', csvMoney(s.gross)], ['Discounts', csvMoney(s.discounts)], ['Net sales', csvMoney(s.net)],
      ['Tax', csvMoney(s.tax)], ['Service charge', csvMoney(s.service)], ['Total', csvMoney(s.total)], ['Tips', csvMoney(s.tips)],
      ['Cost of goods', csvMoney(s.cost)], ['Gross profit', csvMoney(s.profit)], ['Margin %', s.margin.toFixed(1)],
      ['Average check', csvMoney(s.avgCheck)], ['Voids', csvMoney(this.voidTotal())],
    ]);
  }

  exportDaily(): void {
    downloadCsv(this.file('date-wise-sales'), ['Date', 'Orders', 'Guests', 'Items', 'Gross', 'Discounts', 'Net', 'Tax', 'Service', 'Total', 'Tips', 'Avg check', 'Cost', 'Profit'],
      [...this.meta(), ...this.dailyRows().map((d) => [d.date, d.orders, d.guests, d.items, csvMoney(d.gross), csvMoney(d.discount), csvMoney(d.net), csvMoney(d.tax), csvMoney(d.service), csvMoney(d.total), csvMoney(d.tips), csvMoney(d.avg), csvMoney(d.cost), csvMoney(d.profit)])]);
  }

  exportItems(): void {
    downloadCsv(this.file('item-wise-sales'), ['Item', 'Category', 'Qty', 'Orders', 'Avg price', 'Gross', 'Discounts', 'Net', 'Cost', 'Profit', 'Margin %', 'Share %'],
      [...this.meta(), ...this.itemRows().map((r) => [r.name, r.category, r.qty, r.orders, csvMoney(r.avgPrice), csvMoney(r.gross), csvMoney(r.discount), csvMoney(r.net), csvMoney(r.cost), csvMoney(r.profit), r.margin.toFixed(1), r.share.toFixed(1)])]);
  }

  exportLines(): void {
    downloadCsv(this.file('item-sales-detail'), ['Date & time', 'Order', 'Type', 'Table', 'Section', 'Waiter', 'Item', 'Category', 'Qty', 'Price', 'Gross', 'Discount', 'Net', 'Tax', 'Total', 'Cost', 'Notes'],
      [...this.meta(), ...this.lineRegister().map((r) => [this.dt(r.at), r.order.orderNumber, enumLabel(r.order.type), r.tableName, r.section, this.directory.name(r.waiterId), r.name, r.category, r.qty, csvMoney(r.price), csvMoney(r.gross), csvMoney(r.discount), csvMoney(r.net), csvMoney(r.tax), csvMoney(r.total), csvMoney(r.cost), r.line.notes ?? ''])]);
  }

  exportOrders(): void {
    downloadCsv(this.file('orders-register'), ['Opened', 'Order', 'Type', 'Table', 'Waiter', 'Guests', 'Items', 'Net', 'Total', 'Paid', 'Balance', 'Status', 'Payment', 'Minutes'],
      [...this.meta(), ...this.orderRegister().map((o) => [this.dt(o.at), o.number, enumLabel(o.type), o.table, o.waiter, o.guests, o.items, csvMoney(o.net), csvMoney(o.total), csvMoney(o.paid), csvMoney(o.balance), o.status, o.payment, o.minutes ?? ''])]);
  }

  exportTables(): void {
    downloadCsv(this.file('table-wise-sales'), ['Table', 'Section', 'Orders', 'Guests', 'Items', 'Net', 'Total', 'Avg check', 'Net per guest', 'Avg minutes', 'Share %'],
      [...this.meta(), ...this.tableRows().map((t) => [t.name, t.section, t.orders, t.guests, t.items, csvMoney(t.net), csvMoney(t.total), csvMoney(t.avg), csvMoney(t.perGuest), t.avgMinutes ?? '', t.share.toFixed(1)])]);
  }

  exportStaff(): void {
    downloadCsv(this.file('waiter-wise-sales'), ['Waiter', 'Orders', 'Guests', 'Items', 'Net', 'Total', 'Avg check', 'Tips', 'Share %'],
      [...this.meta(), ...this.waiterRows().map((r) => [r.name, r.orders, r.guests, r.items, csvMoney(r.net), csvMoney(r.total), csvMoney(r.avg), csvMoney(r.tips), r.share.toFixed(1)])]);
  }

  exportHours(): void {
    downloadCsv(this.file('hour-wise-sales'), ['Hour', 'Net sales', 'Orders'], [...this.meta(), ...this.hourly().map((h) => [h.label, csvMoney(h.value), h.sub?.split(' ')[0]])]);
  }

  exportPayments(): void {
    downloadCsv(this.file('payments'), ['Date', 'Type', 'Method', 'Amount', 'Tip', 'Cash received', 'Change', 'Order', 'Processed by', 'Note'],
      [...this.meta(), ...this.paymentsDone().map((p) => [this.dt(p.processedAt), p.type, p.method, csvMoney(p.type === 'refund' ? -p.amount : p.amount), csvMoney(p.tipAmount), p.cashTendered ? csvMoney(p.cashTendered) : '', p.changeDue ? csvMoney(p.changeDue) : '', this.allOrders().find((o) => o.id === p.orderId)?.orderNumber ?? '', this.directory.name(p.processedBy), p.note ?? ''])]);
  }

  exportInventory(): void {
    downloadCsv(this.file('ingredient-usage'), ['Ingredient', 'Unit', 'Used', 'Cost'], [...this.meta(), ...this.consumption().map((r) => [r.name, r.unit, formatQty(r.used), csvMoney(r.cost)])]);
  }

  exportStock(): void {
    downloadCsv(`stock-valuation.csv`, ['Item', 'SKU', 'In stock', 'Unit', 'Reorder level', 'Avg cost', 'Value'],
      this.stock().byValue.map((i) => [i.name, i.sku ?? '', formatQty(i.currentStock), i.unit, formatQty(i.reorderLevel), csvMoney(i.averageCost), csvMoney(i.stockValue)]));
  }

  exportPurchasing(): void {
    downloadCsv(this.file('purchase-orders'), ['PO', 'Supplier', 'Created', 'Status', 'Total'],
      this.posInRange().map((po) => [po.poNumber, this.supplierName(po), this.dt(po.createdAt), po.status, csvMoney(po.grandTotal)]));
  }

  // ---- Helpers ----------------------------------------------------------------------------------------------
  max(bars: Bar[]): number {
    return Math.max(1, ...bars.map((b) => b.value));
  }

  pct(value: number, bars: Bar[]): number {
    return (Math.max(value, 0) / this.max(bars)) * 100;
  }

  money(cents: number): string {
    return formatMoney(cents, this.auth.currency(), this.auth.locale());
  }

  hourLabel(h: number): string {
    const hh = h % 24;
    const suffix = hh < 12 ? 'am' : 'pm';
    const n = hh % 12 === 0 ? 12 : hh % 12;
    return `${n}${suffix}`;
  }

  setLinesPage(p: number): void {
    this.linesPage.set(Math.max(1, p));
  }

  setOrdersPage(p: number): void {
    this.ordersPage.set(Math.max(1, p));
  }

  lastPage(count: number): number {
    return Math.max(1, Math.ceil(count / PAGE));
  }

  setPoSupplier(id: string): void {
    this.poSupplier = id;
    this.poSupplierSig.set(id);
  }

  supplierName(po: PurchaseOrder): string {
    return typeof po.supplierId === 'object' && po.supplierId ? po.supplierId.name : this.suppliers().find((s) => s.id === po.supplierId)?.name ?? '—';
  }

  private supplierIdOf(po: PurchaseOrder): string {
    return typeof po.supplierId === 'object' && po.supplierId ? po.supplierId.id : String(po.supplierId);
  }

  private resetPages(): void {
    this.linesPage.set(1);
    this.ordersPage.set(1);
  }

  private tableIdOf(o: Order): string {
    const t = o.tableId;
    return !t ? '' : typeof t === 'object' ? t.id : String(t);
  }

  private tableName(id: string, o: Order): string {
    if (!id) return o.type === 'dine_in' ? 'Counter' : enumLabel(o.type);
    return this.tables().find((t) => t.id === id)?.name ?? (typeof o.tableId === 'object' && o.tableId ? o.tableId.name : '—');
  }

  private tableSection(id: string): string {
    return id ? this.tables().find((t) => t.id === id)?.section || 'Main' : '';
  }

  private categoryName(id?: string): string {
    return (id && this.categories().find((c) => c.id === id)?.name) || 'Uncategorised';
  }

  private groupLines(key: (r: LineRow) => string, label: (k: string) => string): { key: string; label: string; orders: number; net: number; share: number }[] {
    const map = new Map<string, { key: string; orders: Set<string>; net: number }>();
    for (const r of this.lines()) {
      const k = key(r);
      const row = map.get(k) ?? { key: k, orders: new Set<string>(), net: 0 };
      row.orders.add(r.order.id);
      row.net += r.net;
      map.set(k, row);
    }
    const total = [...map.values()].reduce((s, r) => s + r.net, 0);
    return [...map.values()]
      .map((r) => ({ key: r.key, label: label(r.key), orders: r.orders.size, net: r.net, share: total ? (r.net / total) * 100 : 0 }))
      .sort((a, b) => b.net - a.net);
  }

  private sorted<T>(table: string, rows: T[]): T[] {
    const s = this.sort()[table];
    if (!s) return rows;
    return [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[s.key];
      const bv = (b as Record<string, unknown>)[s.key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * s.dir;
    });
  }

  private totalsOf<T>(rows: T[], keys: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of keys) out[k] = rows.reduce((s, r) => s + (Number((r as Record<string, unknown>)[k]) || 0), 0);
    return out;
  }

  private shortDate(day: string): string {
    const [y, m, d] = day.split('-').map(Number);
    return new Intl.DateTimeFormat(this.auth.locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  }

  private dt(iso: string): string {
    return formatDate(iso, 'datetime', this.auth.timezone(), this.auth.locale());
  }
}
