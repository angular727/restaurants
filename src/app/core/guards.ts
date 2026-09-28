import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './enums';
import { ToastService } from './toast.service';

/** Signed in? Otherwise go to the login page. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isAuthenticated()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** A restaurant has been chosen? Otherwise go to the restaurant picker. */
export const tenantGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.tenantId()) return true;
  return inject(Router).createUrlTree(['/select-restaurant']);
};

/** Only for signed-out users (the login page). */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.isAuthenticated()) return true;
  return inject(Router).createUrlTree([auth.tenantId() ? '/dashboard' : '/select-restaurant']);
};

/** Route `data.roles` lists who may open the page. Owners and admins always pass. */
export const roleGuard: CanActivateFn = (route) => {
  const roles = (route.data?.['roles'] as Role[] | undefined) ?? [];
  const auth = inject(AuthService);
  if (!roles.length || auth.hasRole(...roles)) return true;
  inject(ToastService).error("You don't have access to that page.");
  return inject(Router).createUrlTree(['/dashboard']);
};
