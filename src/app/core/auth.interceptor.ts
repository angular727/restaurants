import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ApiError } from './models';

/**
 * Adds `Authorization` and `X-Tenant-ID` to API calls, logs the user out when the
 * token is rejected, and turns every failure into an ApiError with a readable message.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(ApiService);
  const auth = inject(AuthService);
  if (!api.isApiUrl(req.url)) return next(req);

  const token = auth.token();
  const tenantId = auth.tenantId();
  const setHeaders: Record<string, string> = {};
  if (token) setHeaders['Authorization'] = `Bearer ${token}`;
  if (tenantId && !req.url.includes('/auth/')) setHeaders['X-Tenant-ID'] = tenantId;

  return next(req.clone({ setHeaders })).pipe(
    catchError((err: HttpErrorResponse) => {
      const error = toApiError(err);
      const isLogin = req.url.endsWith('/auth/login');
      if (error.status === 401 && !isLogin && token) auth.logout('expired');
      return throwError(() => error);
    })
  );
};

function toApiError(err: HttpErrorResponse): ApiError {
  if (err.status === 0) {
    return {
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check your connection and that the API is running.',
    };
  }
  const body = err.error?.error;
  return {
    status: err.status,
    code: body?.code ?? 'HTTP_' + err.status,
    message: body?.message ?? err.message ?? 'Something went wrong',
    details: body?.details,
    requestId: body?.requestId,
  };
}
