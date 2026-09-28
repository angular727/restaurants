import { NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/auth.service';
import { NAV } from '../core/nav';
import { LabelPipe } from '../core/pipes';
import { ToastService } from '../core/toast.service';

const COLLAPSE_KEY = 'ros.sidebarCollapsed';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [NgFor, NgIf, RouterOutlet, RouterLink, RouterLinkActive, LabelPipe],
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
})
export class ShellComponent {
  auth = inject(AuthService);
  private router = inject(Router);
  private title = inject(Title);
  private toast = inject(ToastService);

  readonly appName = environment.appName;
  readonly collapsed = signal(readCollapsed());
  readonly mobileOpen = signal(false);
  readonly pageTitle = signal('');
  switching = false;

  /** Sidebar sections filtered to what the current role can use. */
  readonly nav = computed(() => {
    this.auth.role(); // re-run when the role changes
    return NAV.map((section) => ({
      ...section,
      items: section.items.filter((i) => !i.roles.length || this.auth.hasRole(...i.roles)),
    })).filter((section) => section.items.length);
  });

  readonly initials = computed(() => {
    const name = this.auth.user()?.name ?? '';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  });

  readonly restaurantName = computed(() => {
    const id = this.auth.tenantId();
    return this.auth.tenant()?.name ?? this.auth.restaurants().find((r) => r.tenantId === id)?.name ?? '';
  });

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef))
      )
      .subscribe(() => {
        this.mobileOpen.set(false);
        this.updateTitle();
      });
    this.updateTitle();
  }

  toggleSidebar(): void {
    if (window.matchMedia('(max-width: 991.98px)').matches) {
      this.mobileOpen.update((v) => !v);
      return;
    }
    this.collapsed.update((v) => !v);
    try {
      localStorage.setItem(COLLAPSE_KEY, this.collapsed() ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  async switchRestaurant(tenantId: string): Promise<void> {
    if (tenantId === this.auth.tenantId() || this.switching) return;
    this.switching = true;
    try {
      await this.auth.selectRestaurant(tenantId);
      this.toast.success(`Switched to ${this.restaurantName()}`);
      await this.router.navigate(['/dashboard']);
    } catch (err) {
      this.toast.apiError(err);
    } finally {
      this.switching = false;
    }
  }

  @HostListener('document:keydown.escape')
  closeMobile(): void {
    this.mobileOpen.set(false);
  }

  private updateTitle(): void {
    let r = this.router.routerState.snapshot.root;
    while (r.firstChild) r = r.firstChild;
    const t = (r.data?.['title'] as string) ?? '';
    this.pageTitle.set(t);
    this.title.setTitle(t ? `${t} · ${this.appName}` : this.appName);
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}
