import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PAYMENT_METHODS } from '../core/enums';
import { formatMoney, fromCents, toCents } from '../core/format';
import { ApiError, Payment } from '../core/models';
import { LabelPipe } from '../core/pipes';
import { ToastService } from '../core/toast.service';
import { ModalComponent } from './modal.component';

/** Refunds (part of) a completed payment. Managers only (enforced by the API as well). */
@Component({
  selector: 'app-refund-dialog',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, ModalComponent, LabelPipe],
  template: `
    <app-modal [open]="open" title="Refund payment" [subtitle]="subtitle()" size="sm" [dismissible]="false" (closed)="close()">
      <div class="mb-3">
        <label class="form-label fw-medium">Refund amount</label>
        <div class="input-group">
          <span class="input-group-text">PKR</span>
          <input type="number" class="form-control tabular" min="0.01" step="0.01" [max]="maxAmount()" [(ngModel)]="amount" />
        </div>
        <div class="text-muted text-xs mt-1">Up to {{ money(refundable) }} can still be refunded on this payment.</div>
      </div>
      <div class="mb-3">
        <label class="form-label fw-medium">Refund method</label>
        <select class="form-select" [(ngModel)]="method">
          <option value="">Same as original ({{ payment?.method | label }})</option>
          <option *ngFor="let m of methods" [value]="m">{{ m | label }}</option>
        </select>
      </div>
      <div>
        <label class="form-label fw-medium">Reason <span class="text-danger">*</span></label>
        <textarea class="form-control" rows="2" maxlength="500" [(ngModel)]="reason" placeholder="e.g. Customer complaint, wrong item"></textarea>
      </div>
      <div *ngIf="error" class="alert alert-danger py-2 px-3 mt-3 mb-0">{{ error }}</div>

      <ng-container modal-footer>
        <button type="button" class="btn btn-light border" (click)="close()" [disabled]="saving">Cancel</button>
        <button type="button" class="btn btn-danger" (click)="submit()" [disabled]="saving || !valid()">
          <span *ngIf="saving" class="spinner-border spinner-border-sm me-2"></span>Refund {{ money(toCents(amount)) }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class RefundDialogComponent implements OnChanges {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  @Input() open = false;
  @Input() payment: Payment | null = null;
  /** Remaining refundable amount in cents (payment amount minus earlier refunds). */
  @Input() refundable = 0;
  @Output() closed = new EventEmitter<void>();
  @Output() refunded = new EventEmitter<void>();

  readonly methods = PAYMENT_METHODS;
  readonly toCents = toCents;
  amount: number | null = null;
  method = '';
  reason = '';
  saving = false;
  error: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.amount = fromCents(this.refundable);
      this.method = '';
      this.reason = '';
      this.error = null;
    }
  }

  subtitle(): string {
    return this.payment ? `Original payment ${this.money(this.payment.amount)} by ${this.payment.method.replace('_', ' ')}` : '';
  }

  maxAmount(): number {
    return this.refundable / 100;
  }

  money(cents: number): string {
    return formatMoney(cents, this.payment?.currency ?? this.auth.currency(), this.auth.locale());
  }

  valid(): boolean {
    const cents = toCents(this.amount);
    return cents > 0 && cents <= this.refundable && !!this.reason.trim();
  }

  close(): void {
    if (!this.saving) this.closed.emit();
  }

  submit(): void {
    if (!this.payment || !this.valid()) return;
    this.saving = true;
    this.error = null;
    const body: Record<string, unknown> = { amount: toCents(this.amount), reason: this.reason.trim() };
    if (this.method) body['method'] = this.method;
    this.api.post(`/payments/${this.payment.id}/refund`, body).subscribe({
      next: () => {
        this.saving = false;
        this.toast.success(`Refunded ${this.money(toCents(this.amount))}`);
        this.refunded.emit();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.error = err.message;
      },
    });
  }
}
