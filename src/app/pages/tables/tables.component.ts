import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { TABLE_STATUS, TableStatus } from '../../core/enums';
import { ApiError, Table } from '../../core/models';
import { LabelPipe } from '../../core/pipes';
import { StaffDirectoryService } from '../../core/staff-directory.service';
import { ToastService } from '../../core/toast.service';
import { ModalComponent } from '../../shared/modal.component';
import { StatusPillComponent } from '../../shared/status-pill.component';

interface Point {
  x: number;
  y: number;
}

const VIEW_KEY = 'ros.tablesView';
const GRID = 10;
const TILE_W = 120;
const TILE_H = 88;

interface TableForm {
  name: string;
  section: string;
  capacity: number;
  status: TableStatus;
  sortOrder: number;
  isActive: boolean;
  assignedWaiterId: string;
}

@Component({
  selector: 'app-tables',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, FormsModule, RouterLink, LabelPipe, StatusPillComponent, ModalComponent],
  templateUrl: './tables.component.html',
  styleUrls: ['./tables.component.scss'],
})
export class TablesComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);
  private router = inject(Router);
  directory = inject(StaffDirectoryService);

  readonly loading = signal(true);
  readonly tables = signal<Table[]>([]);
  readonly filter = signal<'all' | TableStatus>('all');
  /** '' = all tables, otherwise only this waiter's tables. */
  readonly waiterFilter = signal('');
  /** Table CRUD is manager-only in the API; taking orders is for floor staff. */
  readonly canManage = computed(() => this.auth.hasRole('manager'));
  readonly canTakeOrders = computed(() => this.auth.hasRole('manager', 'cashier', 'waiter'));
  readonly statuses = TABLE_STATUS;

  readonly view = signal<'grid' | 'floor'>(readView());
  /** Floor-plan edit mode (managers only): tables can be dragged. */
  editLayout = false;
  savingLayout = false;
  /** Positions being dragged or saved, shown before the server confirms. */
  readonly localPos = signal<Record<string, Point>>({});
  private drag: { id: string; startX: number; startY: number; origin: Point; moved: boolean } | null = null;

  readonly floorTables = computed(() => this.tables().filter((t) => this.canManage() || t.isActive));

  /** Tables never placed (still at 0,0) get a tidy default slot so the plan stays readable. */
  readonly defaultPositions = computed(() => {
    const map: Record<string, Point> = {};
    let i = 0;
    for (const t of this.floorTables()) {
      if (t.position && (t.position.x || t.position.y)) continue;
      map[t.id] = { x: 24 + (i % 6) * (TILE_W + 24), y: 24 + Math.floor(i / 6) * (TILE_H + 32) };
      i++;
    }
    return map;
  });

  readonly canvasSize = computed(() => {
    let w = 0;
    let h = 0;
    for (const t of this.floorTables()) {
      const p = this.pos(t);
      w = Math.max(w, p.x + TILE_W + 40);
      h = Math.max(h, p.y + TILE_H + 40);
    }
    // No hardcoded width floor: CSS min-width:100% already fills the available space, and
    // forcing a fixed minimum (e.g. 900px) caused a needless horizontal scrollbar on narrower
    // screens even though nothing was actually placed out there.
    return { w, h: Math.max(h, 480) };
  });

  editing: Table | null = null;
  showForm = false;
  saving = false;
  formError: string | null = null;
  form: TableForm = this.blank();

  readonly sections = computed(() => {
    const f = this.filter();
    const w = this.waiterFilter();
    const visible = this.tables().filter(
      (t) => (this.canManage() || t.isActive) && (f === 'all' || t.status === f) && (!w || t.assignedWaiterId === w)
    );
    const map = new Map<string, Table[]>();
    for (const t of visible) {
      const key = t.section || 'Main';
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()].map(([name, tables]) => ({ name, tables }));
  });

  readonly summary = computed(() => {
    const active = this.tables().filter((t) => t.isActive);
    return TABLE_STATUS.map((s) => ({ status: s, count: active.filter((t) => t.status === s).length }));
  });

  readonly seatsFree = computed(() =>
    this.tables()
      .filter((t) => t.isActive && t.status === 'available')
      .reduce((n, t) => n + t.capacity, 0)
  );

  readonly existingSections = computed(() => [...new Set(this.tables().map((t) => t.section || 'Main'))].sort());

  ngOnInit(): void {
    this.directory.load();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.getAll<Table>('/tables').subscribe({
      next: (t) => {
        this.tables.set(t);
        this.loading.set(false);
      },
      error: (err) => {
        this.toast.apiError(err);
        this.loading.set(false);
      },
    });
  }

  onTableClick(t: Table): void {
    if (t.currentOrderId) {
      // Open it in the POS running-order view (add items, change waiter/guests, take payment),
      // the same screen a waiter already works from — not the read-only Order Detail page.
      this.router.navigate(['/pos'], { queryParams: { orderId: t.currentOrderId } });
    } else if (this.canTakeOrders() && t.isActive && (t.status === 'available' || t.status === 'reserved')) {
      this.router.navigate(['/pos'], { queryParams: { tableId: t.id } });
    }
  }

  // ---- Floor plan (Table.position) -------------------------------------------------
  setView(v: 'grid' | 'floor'): void {
    this.view.set(v);
    if (v === 'grid') this.editLayout = false;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }

  pos(t: Table): Point {
    const local = this.localPos()[t.id];
    if (local) return local;
    if (t.position && (t.position.x || t.position.y)) return t.position;
    return this.defaultPositions()[t.id] ?? { x: 24, y: 24 };
  }

  unplacedCount(): number {
    return Object.keys(this.defaultPositions()).length;
  }

  onFloorClick(t: Table): void {
    if (!this.editLayout) this.onTableClick(t);
  }

  onPointerDown(t: Table, event: PointerEvent): void {
    if (!this.editLayout) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.drag = { id: t.id, startX: event.clientX, startY: event.clientY, origin: { ...this.pos(t) }, moved: false };
  }

  onPointerMove(event: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const x = Math.max(0, Math.round((d.origin.x + dx) / GRID) * GRID);
    const y = Math.max(0, Math.round((d.origin.y + dy) / GRID) * GRID);
    this.localPos.update((m) => ({ ...m, [d.id]: { x, y } }));
  }

  onPointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.moved) return;
    const table = this.tables().find((t) => t.id === d.id);
    const p = this.localPos()[d.id];
    if (table && p) this.savePosition(table, p);
  }

  /** Lays every table out in rows grouped by section, then saves them one request at a time. */
  async autoArrange(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Auto-arrange the floor plan?',
      message: 'Every table is placed in tidy rows, grouped by section. You can fine-tune by dragging afterwards.',
      confirmText: 'Arrange',
    });
    if (!ok) return;
    this.savingLayout = true;
    const bySection = new Map<string, Table[]>();
    for (const t of this.floorTables()) {
      const key = t.section || 'Main';
      bySection.set(key, [...(bySection.get(key) ?? []), t]);
    }
    const planned: Record<string, Point> = {};
    let top = 24;
    for (const list of bySection.values()) {
      list.forEach((t, i) => {
        planned[t.id] = { x: 24 + (i % 6) * (TILE_W + 24), y: top + Math.floor(i / 6) * (TILE_H + 32) };
      });
      top += Math.ceil(list.length / 6) * (TILE_H + 32) + 40;
    }
    this.localPos.set({ ...planned });
    let failed = 0;
    for (const t of this.floorTables()) {
      if (!(await this.savePosition(t, planned[t.id]))) failed++;
    }
    this.savingLayout = false;
    if (failed) this.toast.error(`${failed} table(s) could not be saved`);
    else this.toast.success('Floor plan arranged');
  }

  private savePosition(t: Table, p: Point): Promise<boolean> {
    const clear = () =>
      this.localPos.update((m) => {
        const next = { ...m };
        delete next[t.id];
        return next;
      });
    return new Promise((resolve) => {
      this.api.patch(`/tables/${t.id}`, { position: p }).subscribe({
        next: () => {
          this.tables.update((list) => list.map((x) => (x.id === t.id ? { ...x, position: p } : x)));
          clear();
          resolve(true);
        },
        error: (err) => {
          this.toast.apiError(err, `Could not move ${t.name}`);
          clear();
          resolve(false);
        },
      });
    });
  }

  // ---- Waiter assignment ---------------------------------------------------------------
  showAssign = false;
  assigning = false;
  /** Section name → waiter id ('' = nobody, '*' = mixed, leave as is). */
  sectionWaiter: Record<string, string> = {};

  waiterInitials(userId?: string | null): string {
    return this.directory
      .name(userId)
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  myTablesCount(): number {
    const me = this.auth.user()?.id;
    return this.tables().filter((t) => t.isActive && t.assignedWaiterId === me).length;
  }

  openAssign(): void {
    this.sectionWaiter = {};
    for (const name of this.existingSections()) {
      const ids = new Set(this.tablesIn(name).map((t) => t.assignedWaiterId ?? ''));
      this.sectionWaiter[name] = ids.size === 1 ? [...ids][0] : '*';
    }
    this.showAssign = true;
  }

  tablesIn(section: string): Table[] {
    return this.tables().filter((t) => (t.section || 'Main') === section);
  }

  /** Saves each changed table one request at a time. */
  async saveAssign(): Promise<void> {
    this.assigning = true;
    let changed = 0;
    let failed = 0;
    for (const [section, waiterId] of Object.entries(this.sectionWaiter)) {
      if (waiterId === '*') continue;
      for (const t of this.tablesIn(section)) {
        if ((t.assignedWaiterId ?? '') === waiterId) continue;
        const ok = await new Promise<boolean>((resolve) =>
          this.api.patch(`/tables/${t.id}`, { assignedWaiterId: waiterId || null }).subscribe({
            next: () => resolve(true),
            error: () => resolve(false),
          })
        );
        if (ok) changed++;
        else failed++;
      }
    }
    this.assigning = false;
    this.showAssign = false;
    if (failed) this.toast.error(`${failed} table(s) could not be updated`);
    else this.toast.success(changed ? `Waiters assigned to ${changed} table(s)` : 'No changes');
    this.load();
  }

  // ---- Manager actions ---------------------------------------------------------------
  create(): void {
    this.editing = null;
    this.form = this.blank();
    this.formError = null;
    this.showForm = true;
  }

  edit(t: Table, event?: Event): void {
    event?.stopPropagation();
    this.editing = t;
    this.form = {
      name: t.name,
      section: t.section ?? 'Main',
      capacity: t.capacity,
      status: t.status,
      sortOrder: t.sortOrder ?? 0,
      isActive: t.isActive,
      assignedWaiterId: t.assignedWaiterId ?? '',
    };
    this.formError = null;
    this.showForm = true;
  }

  save(): void {
    if (!this.form.name.trim() || !(this.form.capacity >= 1 && this.form.capacity <= 50)) {
      this.formError = 'Name is required and capacity must be between 1 and 50.';
      return;
    }
    this.saving = true;
    const body = {
      ...this.form,
      name: this.form.name.trim(),
      section: this.form.section.trim() || 'Main',
      assignedWaiterId: this.form.assignedWaiterId || null,
    };
    const req = this.editing ? this.api.patch(`/tables/${this.editing.id}`, body) : this.api.post('/tables', body);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showForm = false;
        this.toast.success(this.editing ? `Table ${body.name} updated` : `Table ${body.name} added`);
        this.load();
      },
      error: (err: ApiError) => {
        this.saving = false;
        this.formError = err.message;
      },
    });
  }

  setStatus(t: Table, status: TableStatus, event: Event): void {
    event.stopPropagation();
    this.api.patch(`/tables/${t.id}`, { status }).subscribe({
      next: () => {
        this.toast.success(`${t.name} marked ${status.replace(/_/g, ' ')}`);
        this.load();
      },
      error: (err) => this.toast.apiError(err),
    });
  }

  async remove(t: Table, event: Event): Promise<void> {
    event.stopPropagation();
    if (t.currentOrderId) {
      this.toast.error(`${t.name} has an open order. Close it first.`);
      return;
    }
    const ok = await this.confirm.ask({
      title: `Delete table ${t.name}?`,
      message: 'It will disappear from the floor plan. Past orders keep their table reference.',
      confirmText: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    this.api.delete(`/tables/${t.id}`).subscribe({
      next: () => {
        this.toast.success(`Table ${t.name} deleted`);
        this.load();
      },
      error: (err) => this.toast.apiError(err),
    });
  }

  /** Statuses a manager can set by hand. "Occupied" is set only by opening an order. */
  manualStatuses(t: Table): TableStatus[] {
    return TABLE_STATUS.filter((s) => s !== t.status && s !== 'occupied');
  }

  hint(t: Table): string {
    if (t.currentOrderId) return 'Open order';
    if (!t.isActive) return 'Inactive';
    if (this.canTakeOrders() && (t.status === 'available' || t.status === 'reserved')) return 'New order';
    return '';
  }

  trackById(_: number, t: Table): string {
    return t.id;
  }

  private blank(): TableForm {
    return { name: '', section: 'Main', capacity: 4, status: 'available', sortOrder: 0, isActive: true, assignedWaiterId: '' };
  }
}

function readView(): 'grid' | 'floor' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'floor' ? 'floor' : 'grid';
  } catch {
    return 'grid';
  }
}
