import { NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Pagination footer. CRUD lists return `meta.total`; order/payment/PO lists don't, so
 * "Next" is enabled when the page came back full.
 */
@Component({
  selector: 'app-pager',
  standalone: true,
  imports: [NgIf],
  template: `
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 px-3 py-2 border-top">
      <span class="text-muted text-xs">
        <ng-container *ngIf="count; else none">
          Showing {{ from }}–{{ to }}<ng-container *ngIf="total !== undefined && total !== null"> of {{ total }}</ng-container>
        </ng-container>
        <ng-template #none>No results</ng-template>
      </span>
      <div class="btn-group btn-group-sm">
        <button type="button" class="btn btn-light border" [disabled]="page <= 1" (click)="pageChange.emit(page - 1)">
          <i class="bi bi-chevron-left"></i> Previous
        </button>
        <button type="button" class="btn btn-light border" [disabled]="!hasNext" (click)="pageChange.emit(page + 1)">
          Next <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    </div>
  `,
})
export class PagerComponent {
  @Input() page = 1;
  @Input() limit = 20;
  /** Rows on the current page. */
  @Input() count = 0;
  @Input() total?: number | null;
  @Output() pageChange = new EventEmitter<number>();

  get from(): number {
    return (this.page - 1) * this.limit + 1;
  }

  get to(): number {
    return (this.page - 1) * this.limit + this.count;
  }

  get hasNext(): boolean {
    if (this.total !== undefined && this.total !== null) return this.page * this.limit < this.total;
    return this.count === this.limit;
  }
}
