import { Injectable, signal } from '@angular/core';
import { ApiError } from './models';

export interface Toast {
  id: number;
  tone: 'success' | 'danger' | 'info' | 'warning';
  title: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  success(title: string, message?: string): void {
    this.push('success', title, message);
  }

  info(title: string, message?: string): void {
    this.push('info', title, message);
  }

  error(title: string, message?: string): void {
    this.push('danger', title, message, 6000);
  }

  /** Shows an ApiError (or anything thrown) using the server's message. */
  apiError(err: unknown, fallback = 'Something went wrong'): void {
    const e = err as Partial<ApiError>;
    this.error(e?.message || fallback, e?.requestId ? `Reference: ${e.requestId.slice(0, 8)}` : undefined);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(tone: Toast['tone'], title: string, message?: string, ttl = 4000): void {
    const id = this.nextId++;
    this.toasts.update((list) => [...list.slice(-3), { id, tone, title, message }]);
    setTimeout(() => this.dismiss(id), ttl);
  }
}
