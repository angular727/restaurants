import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { SUPPLIER_PAYMENT_TERMS } from '../../core/enums';
import { ApiError, Supplier } from '../../core/models';
import { LabelPipe } from '../../core/pipes';
import { ToastService } from '../../core/toast.service';
import { ModalComponent } from '../../shared/modal.component';

interface SupplierForm {
  name: string;
  code: string;
  contactPerson: string;
  email: string;
  phone: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId: string;
  paymentTerms: string;
  leadTimeDays: number | null;
  notes: string;
  isActive: boolean;
}

@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, LabelPipe, ModalComponent],
  template: `
    <div class="page-header">
      <div>
        <h1>Suppliers</h1>
        <p>Vendors you buy ingredients from, with contacts and payment terms.</p>
      </div>
      <button *ngIf="canEdit()" type="button" class="btn btn-primary" (click)="create()"><i class="bi bi-plus-lg me-1"></i>New supplier</button>
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="search">
          <i class="bi bi-search"></i>
          <input class="form-control form-control-sm" placeholder="Search suppliers" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </div>
        <div class="form-check form-switch ms-2 mb-0">
          <input class="form-check-input" type="checkbox" id="sup-inactive" [ngModel]="showInactive()" (ngModelChange)="showInactive.set($event)" />
          <label class="form-check-label text-xs" for="sup-inactive">Show inactive</label>
        </div>
        <span class="ms-auto text-muted text-xs">{{ filtered().length }} suppliers</span>
      </div>
      <div class="table-responsive">
        <table class="table table-app table-hover">
          <thead>
            <tr><th>Supplier</th><th>Contact</th><th>Payment terms</th><th class="text-center">Lead time</th><th>Status</th><th class="text-end"></th></tr>
          </thead>
          <tbody>
            <ng-container *ngIf="loading()">
              <tr *ngFor="let _ of [1, 2, 3]"><td colspan="6"><span class="skeleton" style="height: 18px"></span></td></tr>
            </ng-container>
            <ng-container *ngIf="!loading()">
              <tr *ngFor="let s of filtered()">
                <td>
                  <div class="fw-semibold">{{ s.name }}</div>
                  <div class="text-muted text-xs"><span *ngIf="s.code">{{ s.code }}</span><span *ngIf="s.address?.city"> · {{ s.address?.city }}</span></div>
                </td>
                <td>
                  <div *ngIf="s.contactPerson">{{ s.contactPerson }}</div>
                  <div class="text-xs">
                    <a *ngIf="s.email" [href]="'mailto:' + s.email">{{ s.email }}</a>
                    <span *ngIf="s.email && s.phone" class="text-muted"> · </span>
                    <span *ngIf="s.phone" class="text-muted">{{ s.phone }}</span>
                  </div>
                  <span *ngIf="!s.contactPerson && !s.email && !s.phone" class="text-muted">—</span>
                </td>
                <td>{{ s.paymentTerms | label }}</td>
                <td class="text-center tabular">{{ s.leadTimeDays }} day{{ s.leadTimeDays === 1 ? '' : 's' }}</td>
                <td><span class="pill" [class.pill-success]="s.isActive" [class.pill-neutral]="!s.isActive">{{ s.isActive ? 'Active' : 'Inactive' }}</span></td>
                <td class="row-actions">
                  <ng-container *ngIf="canEdit()">
                    <button type="button" class="btn btn-sm btn-link" title="Edit" (click)="edit(s)"><i class="bi bi-pencil"></i></button>
                    <button type="button" class="btn btn-sm btn-link text-danger" title="Delete" (click)="remove(s)"><i class="bi bi-trash3"></i></button>
                  </ng-container>
                </td>
              </tr>
              <tr *ngIf="!filtered().length"><td colspan="6"><div class="empty-state"><i class="bi bi-truck"></i>No suppliers found.</div></td></tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>

    <app-modal [open]="showForm" [title]="editing ? 'Edit ' + editing.name : 'New supplier'" size="lg" [dismissible]="false" (closed)="showForm = false">
      <div class="section-title">Company</div>
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label fw-medium required">Name</label><input class="form-control" maxlength="120" [(ngModel)]="form.name" /></div>
        <div class="col-md-3"><label class="form-label fw-medium">Code</label><input class="form-control text-uppercase" maxlength="20" [(ngModel)]="form.code" placeholder="e.g. PRIME" /></div>
        <div class="col-md-3"><label class="form-label fw-medium">Tax ID</label><input class="form-control" maxlength="50" [(ngModel)]="form.taxId" /></div>
      </div>
      <div class="section-title">Contact</div>
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label fw-medium">Contact person</label><input class="form-control" maxlength="120" [(ngModel)]="form.contactPerson" /></div>
        <div class="col-md-4"><label class="form-label fw-medium">Email</label><input type="email" class="form-control" [(ngModel)]="form.email" /></div>
        <div class="col-md-4"><label class="form-label fw-medium">Phone</label><input class="form-control" maxlength="30" [(ngModel)]="form.phone" /></div>
        <div class="col-md-6"><label class="form-label fw-medium">Address</label><input class="form-control" [(ngModel)]="form.line1" placeholder="Street" /></div>
        <div class="col-md-3"><label class="form-label fw-medium">City</label><input class="form-control" [(ngModel)]="form.city" /></div>
        <div class="col-md-3"><label class="form-label fw-medium">State</label><input class="form-control" [(ngModel)]="form.state" /></div>
        <div class="col-md-3"><label class="form-label fw-medium">Postal code</label><input class="form-control" [(ngModel)]="form.postalCode" /></div>
        <div class="col-md-3"><label class="form-label fw-medium">Country</label><input class="form-control" [(ngModel)]="form.country" /></div>
      </div>
      <div class="section-title">Terms</div>
      <div class="row g-3">
        <div class="col-md-4">
          <label class="form-label fw-medium">Payment terms</label>
          <select class="form-select" [(ngModel)]="form.paymentTerms"><option *ngFor="let t of terms" [value]="t">{{ t | label }}</option></select>
        </div>
        <div class="col-md-4">
          <label class="form-label fw-medium">Lead time</label>
          <div class="input-group"><input type="number" class="form-control" min="0" max="365" [(ngModel)]="form.leadTimeDays" /><span class="input-group-text">days</span></div>
        </div>
        <div class="col-md-4 d-flex align-items-end">
          <div class="form-check form-switch mb-2">
            <input class="form-check-input" type="checkbox" id="sup-active" [(ngModel)]="form.isActive" />
            <label class="form-check-label" for="sup-active">Active</label>
          </div>
        </div>
        <div class="col-12"><label class="form-label fw-medium">Notes</label><textarea class="form-control" rows="2" maxlength="2000" [(ngModel)]="form.notes"></textarea></div>
      </div>
      <div *ngIf="error" class="alert alert-danger py-2 px-3 mt-3 mb-0">{{ error }}</div>
      <ng-container modal-footer>
        <button type="button" class="btn btn-light border" (click)="showForm = false" [disabled]="saving">Cancel</button>
        <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving">
          <span *ngIf="saving" class="spinner-border spinner-border-sm me-2"></span>{{ editing ? 'Save changes' : 'Create supplier' }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class SuppliersComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  readonly loading = signal(true);
  readonly suppliers = signal<Supplier[]>([]);
  readonly search = signal('');
  readonly showInactive = signal(false);
  /** Supplier writes: manager and inventory clerk (purchasing.routes.js). */
  readonly canEdit = computed(() => this.auth.hasRole('manager', 'inventory_clerk'));
  readonly terms = SUPPLIER_PAYMENT_TERMS;

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.suppliers().filter(
      (s) =>
        (this.showInactive() || s.isActive) &&
        (!q || [s.name, s.code, s.contactPerson, s.email].some((v) => (v ?? '').toLowerCase().includes(q)))
    );
  });

  showForm = false;
  editing: Supplier | null = null;
  form: SupplierForm = this.blank();
  saving = false;
  error: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.getAll<Supplier>('/suppliers').subscribe({
      next: (s) => {
        this.suppliers.set(s);
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err);
        this.loading.set(false);
      },
    });
  }

  create(): void {
    this.editing = null;
    this.form = this.blank();
    this.error = null;
    this.showForm = true;
  }

  edit(s: Supplier): void {
    this.editing = s;
    this.form = {
      name: s.name,
      code: s.code ?? '',
      contactPerson: s.contactPerson ?? '',
      email: s.email ?? '',
      phone: s.phone ?? '',
      line1: s.address?.line1 ?? '',
      city: s.address?.city ?? '',
      state: s.address?.state ?? '',
      postalCode: s.address?.postalCode ?? '',
      country: s.address?.country ?? '',
      taxId: s.taxId ?? '',
      paymentTerms: s.paymentTerms,
      leadTimeDays: s.leadTimeDays,
      notes: s.notes ?? '',
      isActive: s.isActive,
    };
    this.error = null;
    this.showForm = true;
  }

  save(): void {
    const f = this.form;
    if (!f.name.trim()) {
      this.error = 'Name is required.';
      return;
    }
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
      this.error = 'Enter a valid email address.';
      return;
    }
    const body: Record<string, unknown> = {
      name: f.name.trim(),
      code: f.code.trim(),
      contactPerson: f.contactPerson.trim(),
      phone: f.phone.trim(),
      address: { line1: f.line1.trim(), city: f.city.trim(), state: f.state.trim(), postalCode: f.postalCode.trim(), country: f.country.trim() },
      taxId: f.taxId.trim(),
      paymentTerms: f.paymentTerms,
      leadTimeDays: Math.max(0, Math.min(365, Number(f.leadTimeDays) || 0)),
      notes: f.notes.trim(),
      isActive: f.isActive,
    };
    // Mongoose's `match` validator skips empty strings, so '' clears the email.
    body['email'] = f.email.trim();

    this.saving = true;
    this.error = null;
    const req = this.editing ? this.api.patch(`/suppliers/${this.editing.id}`, body) : this.api.post('/suppliers', body);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showForm = false;
        this.toast.success(this.editing ? `${body['name']} updated` : `${body['name']} added`);
        this.load();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.error = err.message;
      },
    });
  }

  async remove(s: Supplier): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete ${s.name}?`,
      message: 'Existing purchase orders keep their supplier. Consider marking it inactive instead.',
      confirmText: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.delete(`/suppliers/${s.id}`).subscribe({
      next: () => {
        this.toast.success(`${s.name} deleted`);
        this.load();
      },
      error: (err) => this.toast.apiError(err),
    });
  }

  private blank(): SupplierForm {
    return {
      name: '', code: '', contactPerson: '', email: '', phone: '', line1: '', city: '', state: '',
      postalCode: '', country: '', taxId: '', paymentTerms: 'net_30', leadTimeDays: 1, notes: '', isActive: true,
    };
  }
}
