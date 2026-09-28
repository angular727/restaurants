import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ApiItem, ApiList, Order, OrderItem, Payment } from '../../core/models';
import { LabelPipe, MoneyPipe, TzDatePipe } from '../../core/pipes';
import { StaffDirectoryService } from '../../core/staff-directory.service';
import { ToastService } from '../../core/toast.service';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../shared/modal.component';
import { RefundDialogComponent } from '../../shared/refund-dialog.component';
import { StatusPillComponent } from '../../shared/status-pill.component';
import { PaymentDialogComponent } from './payment-dialog.component';

type LineStatus = 'preparing' | 'ready' | 'served';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [
    NgFor, NgIf, FormsModule, RouterLink, MoneyPipe, TzDatePipe, LabelPipe, ModalComponent,
    StatusPillComponent, PaymentDialogComponent, RefundDialogComponent,
  ],
  templateUrl: './order-detail.component.html',
  styleUrls: ['./order-detail.component.scss'],
})
export class OrderDetailComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  directory = inject(StaffDirectoryService);

  readonly order = signal<Order | null>(null);
  readonly payments = signal<Payment[]>([]);
  readonly loading = signal(true);
  busy: string | null = null;

  showPayment = false;
  showWaiter = false;
  waiterChoice = '';
  refundTarget: Payment | null = null;

  // ---- Role checks mirror the backend's requireRole() on each route ----------------
  readonly isFloor = computed(() => this.auth.hasRole('manager', 'cashier', 'waiter'));
  readonly isKitchen = computed(() => this.auth.hasRole('manager', 'chef', 'waiter'));
  readonly isTill = computed(() => this.auth.hasRole('manager', 'cashier'));
  readonly isManager = computed(() => this.auth.hasRole('manager'));

  readonly editable = computed(() => {
    const o = this.order();
    return !!o && !['completed', 'cancelled'].includes(o.status);
  });
  readonly activeItems = computed(() => (this.order()?.items ?? []).filter((i) => i.status !== 'cancelled'));
  readonly pendingCount = computed(() => (this.order()?.items ?? []).filter((i) => i.status === 'pending').length);
  readonly balanceDue = computed(() => this.order()?.balanceDue ?? 0);
  readonly netPaid = computed(() => (this.order()?.amountPaid ?? 0) - (this.order()?.amountRefunded ?? 0));

  readonly tableLabel = computed(() => {
    const t = this.order()?.tableId;
    return t && typeof t === 'object' ? `${t.name}${t.section ? ' · ' + t.section : ''}` : '';
  });

  ngOnInit(): void {
    this.directory.load();
    this.load();
  }

  get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  load(): void {
    this.api.get<ApiItem<Order>>(`/orders/${this.id}`).subscribe({
      next: (res) => {
        this.order.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err, 'Order not found');
        this.loading.set(false);
      },
    });
    this.loadPayments();
  }

  loadPayments(): void {
    this.api.get<ApiList<Payment>>(`/orders/${this.id}/payments`).subscribe({
      next: (res) => this.payments.set(res.data),
      error: () => this.payments.set([]),
    });
  }

  // ---- Actions ---------------------------------------------------------------------
  sendToKitchen(): void {
    this.run('send', this.api.post<ApiItem<Order>>(`/orders/${this.id}/send`), (o) => `${o.orderNumber} sent to the kitchen`);
  }

  setLineStatus(line: OrderItem, status: LineStatus): void {
    this.run(
      `line-${line.id}`,
      this.api.patch<ApiItem<Order>>(`/orders/${this.id}/items/${line.id}/status`, { status }),
      () => `${line.name} marked ${status}`
    );
  }

  async cancelLine(line: OrderItem): Promise<void> {
    const result = await this.confirm.ask({
      title: `Cancel ${line.quantity} × ${line.name}?`,
      message: 'The line will be removed from the bill.',
      confirmText: 'Cancel item',
      tone: 'danger',
      reason: { label: 'Reason', placeholder: 'e.g. Customer changed mind' },
      checkbox: {
        label: 'Return ingredients to stock',
        hint: 'Untick if the dish was already made and thrown away.',
        checked: line.status === 'pending' || line.status === 'sent',
      },
    });
    if (!result) return;
    this.run(
      `line-${line.id}`,
      this.api.post<ApiItem<Order>>(`/orders/${this.id}/items/${line.id}/cancel`, {
        reason: result.reason || undefined,
        returnToStock: result.checked,
      }),
      () => `${line.name} cancelled`
    );
  }

  async complete(): Promise<void> {
    const result = await this.confirm.ask({
      title: 'Close this order?',
      message: 'The bill is fully paid. Completing it closes the ticket and frees the table.',
      confirmText: 'Complete order',
    });
    if (!result) return;
    this.run('complete', this.api.post<ApiItem<Order>>(`/orders/${this.id}/complete`), (o) => `${o.orderNumber} completed`);
  }

  async cancelOrder(): Promise<void> {
    if (this.netPaid() > 0) {
      this.toast.error('Refund all payments before cancelling this order.');
      return;
    }
    const result = await this.confirm.ask({
      title: 'Cancel the whole order?',
      message: 'All items are cancelled and the table is released. This cannot be undone.',
      confirmText: 'Cancel order',
      tone: 'danger',
      reason: { label: 'Reason', required: true, placeholder: 'e.g. Customer left' },
      checkbox: { label: 'Return ingredients to stock', checked: true },
    });
    if (!result) return;
    this.run(
      'cancel',
      this.api.post<ApiItem<Order>>(`/orders/${this.id}/cancel`, { reason: result.reason, returnToStock: result.checked }),
      (o) => `${o.orderNumber} cancelled`
    );
  }

  /** Waiter serving the order (older orders fall back to whoever entered it). */
  waiterId(): string | undefined {
    const o = this.order();
    return o ? this.directory.waiterOf(o) : undefined;
  }

  openWaiter(): void {
    this.waiterChoice = this.waiterId() ?? '';
    this.showWaiter = true;
  }

  saveWaiter(): void {
    if (!this.waiterChoice || this.waiterChoice === this.waiterId()) {
      this.showWaiter = false;
      return;
    }
    this.showWaiter = false;
    this.run(
      'waiter',
      this.api.patch<ApiItem<Order>>(`/orders/${this.id}/waiter`, { waiterId: this.waiterChoice }),
      () => `Waiter changed to ${this.directory.name(this.waiterChoice)}`
    );
  }

  onPaid(order: Order): void {
    this.showPayment = false;
    this.apply(order);
    this.loadPayments();
  }

  onRefunded(): void {
    this.refundTarget = null;
    this.load();
  }

  print(): void {
    window.print();
  }

  // ---- Helpers ---------------------------------------------------------------------
  /** Next kitchen step for a line, or null if none. */
  nextStatus(line: OrderItem): LineStatus | null {
    return ['sent', 'preparing', 'ready'].includes(line.status) ? 'served' : null;
  }

  canCancelLine(line: OrderItem): boolean {
    return this.isTill() && this.editable() && line.status !== 'cancelled';
  }

  refundedAmount(p: Payment): number {
    return this.payments()
      .filter((r) => r.type === 'refund' && r.refundOf === p.id && r.status === 'completed')
      .reduce((sum, r) => sum + r.amount, 0);
  }

  refundable(p: Payment): number {
    return p.type === 'payment' && p.status === 'completed' ? Math.max(p.amount - this.refundedAmount(p), 0) : 0;
  }

  /** Action responses carry tableId as a plain id; keep the populated table from GET /orders/:id. */
  private apply(order: Order): void {
    const current = this.order()?.tableId;
    const keepTable = current && typeof current === 'object' && typeof order.tableId === 'string' && current.id === order.tableId;
    this.order.set(keepTable ? { ...order, tableId: current } : order);
  }

  private async run(key: string, request: Observable<ApiItem<Order>>, message: (o: Order) => string): Promise<void> {
    this.busy = key;
    try {
      const res = await firstValueFrom(request);
      this.apply(res.data);
      this.toast.success(message(res.data));
    } catch (err) {
      this.toast.apiError(err);
    } finally {
      this.busy = null;
    }
  }
}
