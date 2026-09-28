import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth.service';
import { LabelPipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-select-restaurant',
  standalone: true,
  imports: [NgFor, NgIf, LabelPipe],
  template: `
    <div class="picker-page">
      <div class="picker">
        <div class="d-flex align-items-center gap-2 mb-4">
          <span class="logo-mark"><i class="bi bi-layers-fill"></i></span>
          <span class="fw-bold fs-6">{{ appName }}</span>
        </div>

        <h1 class="h4 mb-1">Choose a restaurant</h1>
        <p class="text-muted mb-4">
          Signed in as <span class="fw-medium text-body">{{ auth.user()?.email }}</span>
        </p>

        <div *ngIf="loading" class="d-grid gap-2">
          <span class="skeleton" style="height: 68px" *ngFor="let _ of [1, 2]"></span>
        </div>

        <div *ngIf="!loading && !auth.restaurants().length" class="card">
          <div class="empty-state">
            <i class="bi bi-shop"></i>
            <div class="fw-semibold text-body mb-1">No restaurants yet</div>
            <div>Your account isn't a member of any restaurant. Ask an owner or manager to invite you.</div>
          </div>
        </div>

        <div class="list-group shadow-sm" *ngIf="!loading && auth.restaurants().length">
          <button
            type="button"
            *ngFor="let r of auth.restaurants()"
            class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3"
            [disabled]="selecting !== null"
            (click)="choose(r.tenantId)"
          >
            <span class="avatar">{{ r.name.charAt(0) }}</span>
            <span class="flex-grow-1 text-start min-w-0">
              <span class="d-block fw-semibold text-truncate">{{ r.name }}</span>
              <span class="d-block text-muted text-xs">{{ r.role | label }} · {{ r.slug }}</span>
            </span>
            <span *ngIf="selecting === r.tenantId" class="spinner-border spinner-border-sm text-primary"></span>
            <i *ngIf="selecting !== r.tenantId" class="bi bi-chevron-right text-muted"></i>
          </button>
        </div>

        <button type="button" class="btn btn-link text-muted px-0 mt-4" (click)="auth.logout()">
          <i class="bi bi-box-arrow-left me-1"></i>Sign out
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .picker-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
        background: radial-gradient(900px 400px at 50% -10%, rgba(43, 89, 195, 0.1), transparent 70%), var(--bs-body-bg);
      }
      .picker { width: 100%; max-width: 460px; }
      .logo-mark {
        display: inline-flex; align-items: center; justify-content: center;
        width: 34px; height: 34px; border-radius: 9px;
        background: linear-gradient(135deg, #3b6ee0, #2447a3); color: #fff;
      }
      .avatar {
        display: inline-flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
        background: #eaf0fc; color: var(--bs-primary); font-weight: 700;
      }
    `,
  ],
})
export class SelectRestaurantComponent implements OnInit {
  auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);

  readonly appName = environment.appName;
  loading = true;
  selecting: string | null = null;

  async ngOnInit(): Promise<void> {
    try {
      await firstValueFrom(this.auth.loadMe());
    } catch (err) {
      this.toast.apiError(err);
    } finally {
      this.loading = false;
    }
  }

  async choose(tenantId: string): Promise<void> {
    this.selecting = tenantId;
    try {
      await this.auth.selectRestaurant(tenantId);
      await this.router.navigate(['/dashboard']);
    } catch (err) {
      this.toast.apiError(err);
    } finally {
      this.selecting = null;
    }
  }
}
