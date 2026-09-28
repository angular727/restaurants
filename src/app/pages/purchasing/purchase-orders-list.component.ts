import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PO_STATUS } from '../../core/enums';
import { ApiList, PurchaseOrder, Supplier } from '../../core/models';
import { LabelPipe, MoneyPipe, TzDatePipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';
import { PagerComponent } from '../../shared/pager.component';
import { StatusPillComponent } from '../../shared/status-pill.component';

@Component({
  selector: 'app-purchase-orders-list',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, RouterLink, MoneyPipe, TzDatePipe, LabelPipe, StatusPillComponent, PagerComponent],
  template: `
    <div class="page-header">
      <div>
        <h1>Purchase Orders</h1>
        <p>Order from suppliers, then receive the goods into stock.</p>
      </div>
      <a *ngIf="canCreate()" routerLink="/purchase-orders/new" class="btn btn-primary"><i class="bi bi-plus-lg me-1"></i>New purchase order</a>
    </div>

    <div class="card">
      <div class="toolbar">
        <select class="form-select form-select-sm w-auto" [(ngModel)]="status" (ngModelChange)="page = 1; load()">
          <option value="">All statuses</option>
          <option *ngFor="let s of statuses" [value]="s">{{ s | label }}</option>
        </select>
        <select class="form-select form-select-sm w-auto" [(ngModel)]="supplierId" (ngModelChange)="page = 1; load()">
          <option value="">All suppliers</option>
          <option *ngFor="let s of suppliers()" [value]="s.id">{{ s.name }}</option>
        </select>
        <button type="button" class="btn btn-sm btn-light border ms-auto" (click)="load()" [disabled]="loading()">
          <i class="bi bi-arrow-clockwise me-1"></i>Refresh
        </button>
      </div>
      <div class="table-responsive">
        <table class="table table-app table-hover">
          <thead>
            <tr><th>PO</th><th>Supplier</th><th>Created</th><th>Expected</th><th class="text-center">Lines</th><th>Status</th><th class="text-end">Total</th></tr>
          </thead>
          <tbody>
            <ng-container *ngIf="loading()">
              <tr *ngFor="let _ of [1, 2, 3, 4]"><td colspan="7"><span class="skeleton" style="height: 18px"></span></td></tr>
            </ng-container>
            <ng-container *ngIf="!loading()">
              <tr *ngFor="let po of orders()" class="clickable" (click)="router.navigate(['/purchase-orders', po.id])">
                <td class="fw-semibold">{{ po.poNumber }}</td>
                <td>{{ supplierName(po) }}</td>
                <td>{{ po.createdAt | tzDate: 'date' }}</td>
                <td>{{ po.expectedDeliveryDate ? (po.expectedDeliveryDate | tzDate: 'date') : '—' }}</td>
                <td class="text-center tabular">{{ po.items.length }}</td>
                <td><app-status-pill [status]="po.status"></app-status-pill></td>
                <td class="text-end fw-semibold tabular">{{ po.grandTotal | money }}</td>
              </tr>
              <tr *ngIf="!orders().length">
                <td colspan="7"><div class="empty-state"><i class="bi bi-clipboard-check"></i>No purchase orders found.</div></td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
      <app-pager [page]="page" [limit]="limit" [count]="orders().length" (pageChange)="page = $event; load()"></app-pager>
    </div>
  `,
})
export class PurchaseOrdersListComponent implements OnInit {
  auth = inject(AuthService);
  router = inject(Router);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly statuses = PO_STATUS;
  readonly limit = 20;
  readonly loading = signal(true);
  readonly orders = signal<PurchaseOrder[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  /** Creating POs: manager and inventory clerk (purchasing.routes.js `buyer`). */
  readonly canCreate = computed(() => this.auth.hasRole('manager', 'inventory_clerk'));

  status = '';
  supplierId = '';
  page = 1;

  ngOnInit(): void {
    this.api.getAll<Supplier>('/suppliers').subscribe({ next: (s) => this.suppliers.set(s), error: () => undefined });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api
      .get<ApiList<PurchaseOrder>>('/purchase-orders', { status: this.status, supplierId: this.supplierId, page: this.page, limit: this.limit })
      .subscribe({
        next: (res) => {
          this.orders.set(res.data);
          this.loading.set(false);
        },
        error: (err) => {
          this.toast.apiError(err);
          this.loading.set(false);
        },
      });
  }

  supplierName(po: PurchaseOrder): string {
    return typeof po.supplierId === 'object' && po.supplierId ? po.supplierId.name : this.suppliers().find((s) => s.id === po.supplierId)?.name ?? '—';
  }
}
