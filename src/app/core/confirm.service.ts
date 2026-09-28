import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  tone?: 'primary' | 'danger';
  /** Ask for a free-text reason (e.g. why an item is cancelled). */
  reason?: { label: string; required?: boolean; placeholder?: string };
  /** Optional checkbox, e.g. "Return ingredients to stock". */
  checkbox?: { label: string; hint?: string; checked: boolean };
}

export interface ConfirmResult {
  reason: string;
  checked: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (result: ConfirmResult | null) => void;
}

/** Promise-based confirmation dialog: `const r = await confirm.ask({...}); if (!r) return;` */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<PendingConfirm | null>(null);

  ask(options: ConfirmOptions): Promise<ConfirmResult | null> {
    this.current()?.resolve(null);
    return new Promise((resolve) => this.current.set({ ...options, resolve }));
  }

  settle(result: ConfirmResult | null): void {
    const pending = this.current();
    this.current.set(null);
    pending?.resolve(result);
  }
}
