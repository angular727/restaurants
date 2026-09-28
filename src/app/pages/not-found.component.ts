import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="d-flex align-items-center justify-content-center" style="min-height: 100vh">
      <div class="text-center px-3">
        <div class="display-4 fw-bold text-primary mb-2">404</div>
        <h1 class="h4">Page not found</h1>
        <p class="text-muted mb-4">The page you're looking for doesn't exist or has moved.</p>
        <a routerLink="/dashboard" class="btn btn-primary"><i class="bi bi-house me-1"></i>Go to dashboard</a>
      </div>
    </div>
  `,
})
export class NotFoundComponent {}
