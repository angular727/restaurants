import { NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth.service';
import { slugify } from '../../core/format';
import { ApiError } from '../../core/models';

const CURRENCIES = ['PKR'];

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, RouterLink],
  template: `
    <div class="register-page">
      <div class="register-card">
        <div class="d-flex align-items-center gap-2 mb-4">
          <span class="logo-mark"><svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor"><path d="M11.2 7c.44 0 .8.36.8.8v6.4a2.4 2.4 0 0 1-1.6 2.264V24.2a.8.8 0 0 1-1.6 0v-7.736A2.4 2.4 0 0 1 7.2 14.2V7.8a.8.8 0 0 1 1.6 0v5.6h.8V7.8a.8.8 0 0 1 1.6 0v5.6h.8V7.8c0-.44.36-.8.8-.8Z"/><path d="M22.2 7c.44 0 .8.36.8.8v6.75c0 1.36-.86 2.52-2.07 2.96V24.2a.8.8 0 0 1-1.6 0v-6.69C18.13 17.07 17.27 15.91 17.27 14.55c0-2.7 1.6-6.75 3.93-7.5.34-.11.7.03.9.32.13.19.1.44-.06.6-1.23 1.24-2.27 3.66-2.27 5.68 0 1.02.63 1.9 1.53 2.26V7.8c0-.44.36-.8.8-.8Z"/></svg></span>
          <span class="fw-bold fs-6">{{ appName }}</span>
        </div>
        <h1 class="h4 mb-1">Create your restaurant</h1>
        <p class="text-muted mb-4">Set up your workspace. You'll be the owner with full access.</p>

        <div *ngIf="error" class="alert alert-danger py-2 px-3"><i class="bi bi-exclamation-circle me-1"></i>{{ error }}</div>

        <form (ngSubmit)="submit()" novalidate>
          <div class="section-title">Your account</div>
          <div class="row g-3">
            <div class="col-12">
              <label class="form-label fw-medium required" for="r-name">Full name</label>
              <input id="r-name" name="name" class="form-control" [(ngModel)]="name" autocomplete="name" />
            </div>
            <div class="col-12">
              <label class="form-label fw-medium required" for="r-email">Work email</label>
              <input id="r-email" name="email" type="email" class="form-control" [(ngModel)]="email" autocomplete="username" />
            </div>
            <div class="col-12">
              <label class="form-label fw-medium required" for="r-pass">Password</label>
              <input id="r-pass" name="password" type="password" class="form-control" [(ngModel)]="password" autocomplete="new-password" />
              <div class="form-text">At least 8 characters.</div>
            </div>
          </div>

          <div class="section-title">Restaurant</div>
          <div class="row g-3">
            <div class="col-12">
              <label class="form-label fw-medium required" for="r-rest">Restaurant name</label>
              <input id="r-rest" name="restaurantName" class="form-control" [(ngModel)]="restaurantName" (ngModelChange)="onNameChange($event)" />
            </div>
            <div class="col-12">
              <label class="form-label fw-medium required" for="r-slug">Workspace ID</label>
              <input id="r-slug" name="slug" class="form-control" [(ngModel)]="slug" (ngModelChange)="slugTouched = true" maxlength="60" />
              <div class="form-text">Lowercase letters, numbers and single hyphens, e.g. golden-fork.</div>
            </div>
            <div class="col-sm-5">
              <label class="form-label fw-medium" for="r-cur">Currency</label>
              <select id="r-cur" name="currency" class="form-select" [(ngModel)]="currency">
                <option *ngFor="let c of currencies" [value]="c">{{ c }}</option>
              </select>
            </div>
            <div class="col-sm-7">
              <label class="form-label fw-medium" for="r-tz">Timezone</label>
              <input id="r-tz" name="timezone" class="form-control" [(ngModel)]="timezone" list="tz-list" />
              <datalist id="tz-list"><option *ngFor="let t of timezones" [value]="t"></option></datalist>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-lg w-100 mt-4" [disabled]="submitting">
            <span *ngIf="submitting" class="spinner-border spinner-border-sm me-2"></span>Create restaurant
          </button>
        </form>

        <p class="text-center text-muted mt-4 mb-0">Already have an account? <a routerLink="/login" class="fw-medium">Sign in</a></p>
      </div>
    </div>
  `,
  styles: [
    `
      .register-page {
        min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 3rem 1rem;
        background: radial-gradient(900px 400px at 50% -10%, rgba(43, 89, 195, 0.12), transparent 70%), var(--bs-body-bg);
      }
      .register-card {
        width: 100%; max-width: 520px; background: #fff; border: 1px solid var(--app-border);
        border-radius: 16px; padding: 2rem; box-shadow: var(--app-shadow);
      }
      .logo-mark {
        display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;
        border-radius: 9px; background: linear-gradient(135deg, #3b6ee0, #2447a3); color: #fff;
      }
      .btn-lg { font-size: 0.9375rem; }
    `,
  ],
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly appName = environment.appName;
  readonly currencies = CURRENCIES;
  readonly timezones = supportedTimezones();

  name = '';
  email = '';
  password = '';
  restaurantName = '';
  slug = '';
  slugTouched = false;
  currency = 'PKR';
  timezone = 'Asia/Karachi';
  submitting = false;
  error: string | null = null;

  onNameChange(value: string): void {
    if (!this.slugTouched) this.slug = slugify(value);
  }

  async submit(): Promise<void> {
    const problems: string[] = [];
    if (!this.name.trim()) problems.push('Enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) problems.push('Enter a valid email.');
    if (this.password.length < 8) problems.push('Password must be at least 8 characters.');
    if (!this.restaurantName.trim()) problems.push('Enter the restaurant name.');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(this.slug)) problems.push('Workspace ID may only contain a-z, 0-9 and single hyphens.');
    if (problems.length) {
      this.error = problems.join(' ');
      return;
    }

    this.submitting = true;
    this.error = null;
    try {
      await this.auth.register({
        name: this.name.trim(),
        email: this.email.trim(),
        password: this.password,
        restaurant: { name: this.restaurantName.trim(), slug: this.slug, currency: this.currency, timezone: this.timezone.trim() || 'UTC' },
      });
      await this.router.navigate(['/dashboard']);
    } catch (err) {
      const e = err as ApiError;
      this.error = e.code === 'DUPLICATE' ? 'That email or workspace ID is already in use.' : e.message;
    } finally {
      this.submitting = false;
    }
  }
}

function supportedTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : ['UTC'];
  } catch {
    return ['UTC'];
  }
}
