import { NgIf } from '@angular/common';
import { Component, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../core/confirm.service';
import { ModalComponent } from './modal.component';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [NgIf, FormsModule, ModalComponent],
  template: `
    <app-modal [open]="!!c.current()" [title]="c.current()?.title ?? ''" size="sm" (closed)="c.settle(null)">
      <ng-container *ngIf="c.current() as d">
        <p *ngIf="d.message" class="mb-3 text-body">{{ d.message }}</p>
        <div *ngIf="d.reason" class="mb-3">
          <label class="form-label fw-medium">
            {{ d.reason.label }} <span *ngIf="d.reason.required" class="text-danger">*</span>
          </label>
          <textarea class="form-control" rows="2" [(ngModel)]="reason" [placeholder]="d.reason.placeholder ?? ''" maxlength="300"></textarea>
        </div>
        <div *ngIf="d.checkbox" class="form-check">
          <input class="form-check-input" type="checkbox" id="confirm-check" [(ngModel)]="checked" />
          <label class="form-check-label" for="confirm-check">{{ d.checkbox.label }}</label>
          <div *ngIf="d.checkbox.hint" class="text-muted text-xs">{{ d.checkbox.hint }}</div>
        </div>
      </ng-container>
      <ng-container modal-footer>
        <button type="button" class="btn btn-light border" (click)="c.settle(null)">Cancel</button>
        <button
          type="button"
          class="btn"
          [class.btn-danger]="c.current()?.tone === 'danger'"
          [class.btn-primary]="c.current()?.tone !== 'danger'"
          [disabled]="c.current()?.reason?.required && !reason.trim()"
          (click)="c.settle({ reason: reason.trim(), checked })"
        >
          {{ c.current()?.confirmText ?? 'Confirm' }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class ConfirmDialogComponent {
  c = inject(ConfirmService);
  reason = '';
  checked = false;

  constructor() {
    // Reset the inputs every time a new dialog opens.
    effect(() => {
      const d = this.c.current();
      this.reason = '';
      this.checked = d?.checkbox?.checked ?? false;
    }, { allowSignalWrites: true });
  }
}
