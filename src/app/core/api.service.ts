import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Thin typed wrapper around HttpClient for the REST API.
 * Auth and tenant headers are added by AuthInterceptor, and errors arrive as ApiError.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  readonly baseUrl = environment.apiUrl;

  get<T>(path: string, query?: QueryParams): Observable<T> {
    return this.http.get<T>(this.url(path), { params: this.params(query) });
  }

  post<T>(path: string, body: unknown = {}, headers?: Record<string, string>): Observable<T> {
    return this.http.post<T>(this.url(path), body, { headers: headers ? new HttpHeaders(headers) : undefined });
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.url(path), body);
  }

  delete(path: string): Observable<void> {
    return this.http.delete<void>(this.url(path));
  }

  /** Fetches every page of a list endpoint (100 per page, the API maximum). */
  getAll<T>(path: string, query: QueryParams = {}): Observable<T[]> {
    const limit = 100;
    const fetchPage = (page: number): Observable<T[]> =>
      this.get<{ data: T[] }>(path, { ...query, page, limit }).pipe(
        switchMap((res) =>
          res.data.length < limit || page >= 20 ? of(res.data) : fetchPage(page + 1).pipe(map((rest) => [...res.data, ...rest]))
        )
      );
    return fetchPage(1);
  }

  isApiUrl(url: string): boolean {
    return url.startsWith(this.baseUrl);
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private params(query?: QueryParams): HttpParams | undefined {
    if (!query) return undefined;
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return params;
  }
}
