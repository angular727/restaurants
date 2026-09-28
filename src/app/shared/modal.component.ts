import { NgIf } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

/**
 * Angular-controlled dialog styled like a Bootstrap modal.
 *   <app-modal [open]="show" title="Edit item" (closed)="show = false">
 *     ...body...
 *     <ng-container modal-footer>...buttons...</ng-container>
 *   </app-modal>
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [NgIf],
  template: `
    <ng-container *ngIf="open">
      <div class="app-modal-backdrop" (click)="dismissible && closed.emit()"></div>
      <div class="app-modal" role="dialog" aria-modal="true" [attr.aria-label]="title">
        <div class="app-modal-dialog" [class]="'size-' + size">
          <div class="app-modal-header">
            <div class="min-w-0">
              <h2 class="app-modal-title">{{ title }}</h2>
              <div *ngIf="subtitle" class="text-muted text-xs mt-1">{{ subtitle }}</div>
            </div>
            <button type="button" class="btn-close" aria-label="Close" (click)="closed.emit()"></button>
          </div>
          <div class="app-modal-body">
            <ng-content></ng-content>
          </div>
          <div class="app-modal-footer">
            <ng-content select="[modal-footer]"></ng-content>
          </div>
        </div>
      </div>
    </ng-container>
  `,
  styles: [
    `
      .app-modal-backdrop {
        position: fixed; inset: 0; z-index: 1050;
        background: rgba(15, 23, 42, 0.5);
        animation: fade 0.15s ease-out;
      }
      .app-modal {
        position: fixed; inset: 0; z-index: 1055;
        display: flex; align-items: flex-start; justify-content: center;
        padding: 4vh 1rem; overflow-y: auto; pointer-events: none;
      }
      .app-modal-dialog {
        pointer-events: auto;
        width: 100%; background: #fff; border-radius: 14px;
        box-shadow: 0 24px 64px -12px rgba(15, 23, 42, 0.35);
        display: flex; flex-direction: column; max-height: 92vh;
        animation: pop 0.16s ease-out;
      }
      .size-sm { max-width: 420px; }
      .size-md { max-width: 560px; }
      .size-lg { max-width: 800px; }
      .size-xl { max-width: 1080px; }
      .app-modal-header {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
        padding: 1.125rem 1.5rem; border-bottom: 1px solid var(--app-border);
      }
      .app-modal-title { font-size: 1.0625rem; font-weight: 600; margin: 0; }
      .app-modal-body { padding: 1.25rem 1.5rem; overflow-y: auto; }
      .app-modal-footer {
        display: flex; justify-content: flex-end; gap: 0.5rem; flex-wrap: wrap;
        padding: 0.875rem 1.5rem; border-top: 1px solid var(--app-border); background: #f8fafc;
        border-radius: 0 0 14px 14px;
      }
      .app-modal-footer:empty { display: none; }
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.99); } to { opacity: 1; transform: none; } }
    `,
  ],
})
export class ModalComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() subtitle = '';
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  /** Close when the backdrop is clicked. Turn off for forms with unsaved input. */
  @Input() dismissible = true;
  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.closed.emit();
  }
}
