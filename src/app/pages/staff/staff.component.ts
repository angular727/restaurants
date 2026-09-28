import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MEMBER_ROLES } from '../../core/enums';
import { ApiList, Member } from '../../core/models';
import { LabelPipe, TzDatePipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';
import { StatusPillComponent } from '../../shared/status-pill.component';

const ROLE_INFO: Record<string, string> = {
  owner: 'Full access, including everything an admin can do.',
  admin: 'Full access to every module.',
  manager: 'Runs the restaurant: menu, tables, refunds, purchasing approvals, staff list.',
  cashier: 'Takes orders and payments, completes bills, cancels items.',
  waiter: 'Takes orders, sends them to the kitchen, updates dish status, marks items unavailable.',
  chef: 'Kitchen display, menu items and recipes, stock waste and counts.',
  inventory_clerk: 'Inventory items, suppliers, purchase orders and receiving goods.',
};

@Component({
  selector: 'app-staff',
  standalone: true,
  imports: [NgFor, NgIf, LabelPipe, TzDatePipe, StatusPillComponent],
  template: `
    <div class="page-header">
      <div>
        <h1>Staff</h1>
        <p>Everyone with access to {{ auth.tenant()?.name }} and what their role allows.</p>
      </div>
      <button type="button" class="btn btn-light border" (click)="load()" [disabled]="loading()"><i class="bi bi-arrow-clockwise me-1"></i>Refresh</button>
    </div>

    <div class="row g-3">
      <div class="col-xl-8">
        <div class="card">
          <div class="table-responsive">
            <table class="table table-app">
              <thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
              <tbody>
                <ng-container *ngIf="loading()">
                  <tr *ngFor="let _ of [1, 2, 3]"><td colspan="4"><span class="skeleton" style="height: 18px"></span></td></tr>
                </ng-container>
                <ng-container *ngIf="!loading()">
                  <tr *ngFor="let m of sorted()">
                    <td>
                      <div class="d-flex align-items-center gap-3">
                        <span class="avatar">{{ initials(m) }}</span>
                        <div class="min-w-0">
                          <div class="fw-semibold">
                            {{ m.userId?.name ?? 'Unknown user' }}
                            <span *ngIf="m.userId?.id === auth.user()?.id" class="text-muted fw-normal">(you)</span>
                          </div>
                          <div class="text-muted text-xs">{{ m.userId?.email }}</div>
                        </div>
                      </div>
                    </td>
                    <td><span class="pill pill-primary">{{ m.role | label }}</span></td>
                    <td><app-status-pill [status]="m.status"></app-status-pill></td>
                    <td>{{ m.joinedAt || m.createdAt | tzDate: 'date' }}</td>
                  </tr>
                  <tr *ngIf="!members().length"><td colspan="4"><div class="empty-state"><i class="bi bi-people"></i>No members.</div></td></tr>
                </ng-container>
              </tbody>
            </table>
          </div>
        </div>
        <div class="text-muted text-xs mt-2">
          <i class="bi bi-info-circle me-1"></i>The API currently provides a read-only staff list. Inviting members and changing roles aren't available yet.
        </div>
      </div>
      <div class="col-xl-4">
        <div class="card">
          <div class="card-header"><h2 class="card-title-sm">Roles & permissions</h2></div>
          <ul class="list-group list-group-flush">
            <li class="list-group-item" *ngFor="let r of roles">
              <div class="d-flex justify-content-between align-items-center">
                <span class="fw-semibold">{{ r | label }}</span>
                <span class="text-muted text-xs">{{ countFor(r) }} member{{ countFor(r) === 1 ? '' : 's' }}</span>
              </div>
              <div class="text-muted text-xs mt-1">{{ info(r) }}</div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .avatar {
        display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
        background: #eaf0fc; color: var(--bs-primary); font-weight: 600; font-size: 0.8rem;
      }
    `,
  ],
})
export class StaffComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly roles = MEMBER_ROLES;
  readonly loading = signal(true);
  readonly members = signal<Member[]>([]);
  readonly sorted = computed(() =>
    [...this.members()].sort((a, b) => MEMBER_ROLES.indexOf(a.role as never) - MEMBER_ROLES.indexOf(b.role as never))
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.get<ApiList<Member>>('/members').subscribe({
      next: (res) => {
        this.members.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err);
        this.loading.set(false);
      },
    });
  }

  initials(m: Member): string {
    return (m.userId?.name ?? '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  countFor(role: string): number {
    return this.members().filter((m) => m.role === role).length;
  }

  info(role: string): string {
    return ROLE_INFO[role] ?? '';
  }
}
