import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, map, tap } from 'rxjs';
import { ApiService } from './api.service';
import { Role } from './enums';
import { ApiItem, Membership, RestaurantAccess, Tenant, User } from './models';

const STORAGE = {
  token: 'ros.token',
  user: 'ros.user',
  tenantId: 'ros.tenantId',
} as const;

interface LoginResponse {
  token: string;
  user: User;
}

interface MeResponse {
  user: User;
  restaurants: RestaurantAccess[];
}

/**
 * Session state: JWT, signed-in user, the restaurants they belong to and the active
 * restaurant (tenant). Every tenant-scoped request carries `X-Tenant-ID` from here.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);

  readonly token = signal<string | null>(read(STORAGE.token));
  readonly user = signal<User | null>(readJson<User>(STORAGE.user));
  readonly tenantId = signal<string | null>(read(STORAGE.tenantId));
  readonly restaurants = signal<RestaurantAccess[]>([]);
  readonly tenant = signal<Tenant | null>(null);
  readonly membership = signal<Membership | null>(null);

  readonly isAuthenticated = computed(() => !!this.token());
  readonly role = computed<Role | null>(
    () => this.membership()?.role ?? this.restaurants().find((r) => r.tenantId === this.tenantId())?.role ?? null
  );
  readonly currency = computed(() => this.tenant()?.currency ?? 'USD');
  readonly locale = computed(() => this.tenant()?.locale ?? 'en-US');
  readonly timezone = computed(() => this.tenant()?.timezone ?? 'UTC');

  login(email: string, password: string): Observable<User> {
    return this.api.post<LoginResponse>('/auth/login', { email, password }).pipe(
      tap((res) => {
        this.token.set(res.token);
        this.user.set(res.user);
        write(STORAGE.token, res.token);
        write(STORAGE.user, JSON.stringify(res.user));
      }),
      map((res) => res.user)
    );
  }

  /** Onboarding: creates the owner account and the restaurant, then signs in to it. */
  async register(input: {
    name: string;
    email: string;
    password: string;
    restaurant: { name: string; slug: string; currency?: string; timezone?: string };
  }): Promise<void> {
    const res = await firstValueFrom(this.api.post<LoginResponse & { tenant: Tenant }>('/auth/register', input));
    this.token.set(res.token);
    this.user.set(res.user);
    write(STORAGE.token, res.token);
    write(STORAGE.user, JSON.stringify(res.user));
    await firstValueFrom(this.loadMe());
    const tenantId = (res.tenant as Tenant & { id?: string }).id ?? res.tenant._id;
    await this.selectRestaurant(tenantId);
  }

  /** Loads the user's restaurants. Clears a stored tenant the user no longer belongs to. */
  loadMe(): Observable<MeResponse> {
    return this.api.get<MeResponse>('/auth/me').pipe(
      tap((res) => {
        this.user.set(res.user);
        this.restaurants.set(res.restaurants);
        write(STORAGE.user, JSON.stringify(res.user));
        const current = this.tenantId();
        if (current && !res.restaurants.some((r) => r.tenantId === current)) this.clearTenant();
        if (!this.tenantId() && res.restaurants.length === 1) this.setTenantId(res.restaurants[0].tenantId);
      })
    );
  }

  /** Loads the active restaurant's settings (currency, timezone, tax) and the user's membership. */
  loadTenant(): Observable<Tenant> {
    return this.api.get<ApiItem<Tenant> & { membership: Membership }>('/tenant').pipe(
      tap((res) => {
        this.tenant.set(res.data);
        this.membership.set(res.membership);
      }),
      map((res) => res.data)
    );
  }

  async selectRestaurant(tenantId: string): Promise<void> {
    this.setTenantId(tenantId);
    this.tenant.set(null);
    this.membership.set(null);
    await firstValueFrom(this.loadTenant());
  }

  /** Restores the session on page load. Returns false if the stored token is no longer valid. */
  async restore(): Promise<boolean> {
    if (!this.token()) return false;
    try {
      await firstValueFrom(this.loadMe());
      if (this.tenantId()) await firstValueFrom(this.loadTenant());
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }

  /** Owners and admins pass every role check, matching the backend's requireRole(). */
  hasRole(...roles: Role[]): boolean {
    const role = this.role();
    if (!role) return false;
    if (role === 'owner' || role === 'admin') return true;
    return roles.includes(role);
  }

  logout(reason?: 'expired'): void {
    this.clearSession();
    this.router.navigate(['/login'], reason ? { queryParams: { reason } } : undefined);
  }

  private setTenantId(tenantId: string): void {
    this.tenantId.set(tenantId);
    write(STORAGE.tenantId, tenantId);
  }

  private clearTenant(): void {
    this.tenantId.set(null);
    this.tenant.set(null);
    this.membership.set(null);
    remove(STORAGE.tenantId);
  }

  private clearSession(): void {
    this.token.set(null);
    this.user.set(null);
    this.restaurants.set([]);
    this.clearTenant();
    remove(STORAGE.token);
    remove(STORAGE.user);
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const raw = read(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: session lasts for this page only */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
