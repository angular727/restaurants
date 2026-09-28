import { NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';

const ICONS: Record<string, string> = {
  success: 'bi-check-circle-fill',
  danger: 'bi-exclamation-octagon-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
};

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [NgFor, NgIf],
  template: `
    <div class="toast-stack" aria-live="polite">
      <div *ngFor="let t of toasts.toasts(); trackBy: trackById" class="app-toast tone-{{ t.tone }}" role="status">
        <i class="bi {{ icon(t.tone) }}"></i>
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold">{{ t.title }}</div>
          <div *ngIf="t.message" class="text-muted text-xs mt-1">{{ t.message }}</div>
        </div>
        <button type="button" class="btn-close btn-sm" aria-label="Dismiss" (click)="toasts.dismiss(t.id)"></button>
      </div>
    </div>
  `,
  styles: [
    `
      .toast-stack {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 1100;
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
        width: min(380px, calc(100vw - 2rem));
      }
      .app-toast {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
        background: #fff;
        border: 1px solid var(--app-border);
        border-left-width: 4px;
        border-radius: 10px;
        padding: 0.875rem 1rem;
        box-shadow: 0 12px 32px -8px rgba(15, 23, 42, 0.22);
        animation: toast-in 0.18s ease-out;
      }
      .app-toast > i { font-size: 1.125rem; line-height: 1.3; }
      .tone-success { border-left-color: #15803d; } .tone-success > i { color: #15803d; }
      .tone-danger { border-left-color: #b91c1c; } .tone-danger > i { color: #b91c1c; }
      .tone-warning { border-left-color: #b45309; } .tone-warning > i { color: #b45309; }
      .tone-info { border-left-color: #2b59c3; } .tone-info > i { color: #2b59c3; }
      @keyframes toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    `,
  ],
})
export class ToastContainerComponent {
  toasts = inject(ToastService);

  icon(tone: string): string {
    return ICONS[tone] ?? ICONS['info'];
  }

  trackById(_: number, t: { id: number }): number {
    return t.id;
  }
}
