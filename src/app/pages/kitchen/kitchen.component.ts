import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ApiItem, ApiList, Order, OrderItem, Table } from '../../core/models';
import { LabelPipe, TzDatePipe } from '../../core/pipes';
import { StaffDirectoryService } from '../../core/staff-directory.service';
import { ToastService } from '../../core/toast.service';

type LineStatus = 'preparing' | 'ready' | 'served';
const REFRESH_MS = 15000;
/** Lines the kitchen still has to act on. */
const KITCHEN_LINE_STATUS = ['sent', 'preparing', 'ready'];

interface Ticket {
  order: Order;
  lines: OrderItem[];
  firedAt: string;
}

@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, FormsModule, RouterLink, LabelPipe, TzDatePipe],
  templateUrl: './kitchen.component.html',
  styleUrls: ['./kitchen.component.scss'],
})
export class KitchenComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  directory = inject(StaffDirectoryService);

  readonly loading = signal(true);
  readonly orders = signal<Order[]>([]);
  readonly tables = signal<Table[]>([]);
  readonly station = signal('all');
  readonly now = signal(Date.now());
  readonly lastUpdated = signal<Date | null>(null);
  busyLine: string | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private clock?: ReturnType<typeof setInterval>;

  readonly stations = computed(() => {
    const set = new Set<string>();
    for (const o of this.orders()) for (const l of o.items) if (l.kitchenStation && KITCHEN_LINE_STATUS.includes(l.status)) set.add(l.kitchenStation);
    return [...set].sort();
  });

  readonly tickets = computed<Ticket[]>(() => {
    const station = this.station();
    return this.orders()
      .map((order) => {
        const lines = order.items.filter(
          (l) => KITCHEN_LINE_STATUS.includes(l.status) && (station === 'all' || l.kitchenStation === station)
        );
        const fired = lines.map((l) => l.sentAt).filter(Boolean).sort()[0] ?? order.createdAt;
        return { order, lines, firedAt: fired as string };
      })
      .filter((t) => t.lines.length)
      .sort((a, b) => a.firedAt.localeCompare(b.firedAt));
  });

  readonly counts = computed(() => {
    const lines = this.tickets().flatMap((t) => t.lines);
    return {
      sent: lines.filter((l) => l.status === 'sent').length,
      preparing: lines.filter((l) => l.status === 'preparing').length,
      ready: lines.filter((l) => l.status === 'ready').length,
    };
  });

  ngOnInit(): void {
    this.directory.load();
    this.api.getAll<Table>('/tables').subscribe({ next: (t) => this.tables.set(t), error: () => undefined });
    this.load();
    this.timer = setInterval(() => this.load(true), REFRESH_MS);
    this.clock = setInterval(() => this.now.set(Date.now()), 30000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    clearInterval(this.clock);
  }

  /** Orders that can have lines in the kitchen: in progress, ready, and served (more items may be fired). */
  load(silent = false): void {
    if (!silent) this.loading.set(true);
    forkJoin(
      ['in_progress', 'ready', 'served'].map((status) => this.api.get<ApiList<Order>>('/orders', { status, limit: 100 }))
    ).subscribe({
      next: (groups) => {
        this.orders.set(groups.flatMap((g) => g.data));
        this.lastUpdated.set(new Date());
        this.now.set(Date.now());
        this.loading.set(false);
      },
      error: (err) => {
        if (!silent) this.toast.apiError(err);
        this.loading.set(false);
      },
    });
  }

  advance(ticket: Ticket, line: OrderItem): void {
    const next = this.nextStatus(line);
    if (!next) return;
    this.setStatus(ticket.order, line, next);
  }

  /**
   * Updates run one after another: the API loads and saves the whole order per call,
   * so parallel updates to the same order would overwrite each other.
   */
  async bumpAll(ticket: Ticket, status: LineStatus): Promise<void> {
    const lines = ticket.lines.filter((l) => this.nextStatus(l) === status);
    for (const line of lines) {
      const ok = await this.setStatus(ticket.order, line, status);
      if (!ok) break;
    }
  }

  private async setStatus(order: Order, line: OrderItem, status: LineStatus): Promise<boolean> {
    this.busyLine = line.id;
    try {
      const res = await firstValueFrom(this.api.patch<ApiItem<Order>>(`/orders/${order.id}/items/${line.id}/status`, { status }));
      this.orders.update((list) => list.map((o) => (o.id === res.data.id ? res.data : o)));
      return true;
    } catch (err) {
      this.toast.apiError(err);
      return false;
    } finally {
      this.busyLine = null;
    }
  }

  nextStatus(line: OrderItem): LineStatus | null {
    return ['sent', 'preparing', 'ready'].includes(line.status) ? 'served' : null;
  }

  actionLabel(_line: OrderItem): string {
    return 'Served';
  }

  hasStatus(ticket: Ticket, status: string): boolean {
    return ticket.lines.some((l) => l.status === status);
  }

  minutes(ticket: Ticket): number {
    return Math.max(0, Math.floor((this.now() - new Date(ticket.firedAt).getTime()) / 60000));
  }

  urgency(ticket: Ticket): string {
    const m = this.minutes(ticket);
    return m >= 20 ? 'late' : m >= 10 ? 'warn' : 'ok';
  }

  tableName(order: Order): string {
    const t = order.tableId;
    if (!t) return '';
    if (typeof t === 'object') return t.name;
    return this.tables().find((x) => x.id === t)?.name ?? '';
  }

  trackTicket(_: number, t: Ticket): string {
    return t.order.id;
  }

  trackLine(_: number, l: OrderItem): string {
    return l.id;
  }
}
