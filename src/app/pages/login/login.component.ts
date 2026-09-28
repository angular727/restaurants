import { NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth.service';
import { ApiError } from '../../core/models';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [NgIf, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly appName = environment.appName;
  readonly showDemo = environment.showDemoLogin;
  readonly year = new Date().getFullYear();
  readonly expired = this.route.snapshot.queryParamMap.get('reason') === 'expired';

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  showPassword = false;
  submitting = false;
  error: string | null = null;

  fillDemo(): void {
    this.form.setValue({ email: 'owner@goldenfork.test', password: 'Password123!' });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting = true;
    this.error = null;
    try {
      const { email, password } = this.form.getRawValue();
      await firstValueFrom(this.auth.login(email.trim(), password));
      await firstValueFrom(this.auth.loadMe());
      if (this.auth.tenantId()) {
        await firstValueFrom(this.auth.loadTenant());
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        await this.router.navigateByUrl(returnUrl && returnUrl !== '/' ? returnUrl : '/dashboard');
      } else {
        await this.router.navigate(['/select-restaurant']);
      }
    } catch (err) {
      const e = err as ApiError;
      this.error =
        e.code === 'RATE_LIMITED' ? 'Too many sign-in attempts. Please wait a few minutes and try again.' : e.message;
    } finally {
      this.submitting = false;
    }
  }

  invalid(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }
}
