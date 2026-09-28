import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { Order } from './models';

export interface StaffEntry {
  userId: string;
  name: string;
  role: string;
}

/** Roles that serve tables, listed first in waiter pickers. */
const SERVING_ROLES = ['waiter', 'cashier', 'manager', 'admin', 'owner'];

/**
 * Staff names for waiter pickers and "served by" labels, from GET /staff
 * (any member may read it; it returns only name and role).
 */
@Injectable({ providedIn: 'root' })
export class StaffDirectoryService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  private readonly members = signal<StaffEntry[]>([]);
  private loadedFor: string | null = null;

  readonly staff = computed(() => this.members());

  /** People who can serve tables: waiters first, then other front-of-house roles. */
  readonly servers = computed(() =>
    this.members()
      .filter((m) => SERVING_ROLES.includes(m.role))
      .sort((a, b) => SERVING_ROLES.indexOf(a.role) - SERVING_ROLES.indexOf(b.role) || a.name.localeCompare(b.name))
  );

  /** Loads the staff list once per restaurant. */
  load(): void {
    const tenant = this.auth.tenantId();
    if (!tenant || this.loadedFor === tenant) return;
    this.loadedFor = tenant;
    this.api.get<{ data: StaffEntry[] }>('/staff').subscribe({
      next: (res) => this.members.set(res.data),
      error: () => (this.loadedFor = null),
    });
  }

  name(userId: string | null | undefined): string {
    if (!userId) return '—';
    const found = this.members().find((m) => m.userId === userId)?.name;
    if (found) return found;
    const me = this.auth.user();
    return me && me.id === userId ? me.name : 'Staff';
  }

  isMe(userId: string | null | undefined): boolean {
    return !!userId && this.auth.user()?.id === userId;
  }

  /** The waiter serving an order. Orders from before waiterId existed fall back to createdBy. */
  waiterOf(order: Pick<Order, 'waiterId' | 'createdBy'>): string | undefined {
    return order.waiterId || order.createdBy || undefined;
  }
}
