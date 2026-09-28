import { Component, Input } from '@angular/core';
import { STATUS_TONES, enumLabel } from '../core/enums';

/** <app-status-pill status="in_progress" /> → coloured "In progress" pill. */
@Component({
  selector: 'app-status-pill',
  standalone: true,
  template: `<span class="pill pill-{{ tone }}">{{ text }}</span>`,
})
export class StatusPillComponent {
  @Input({ required: true }) status!: string;
  @Input() label?: string;

  get tone(): string {
    return STATUS_TONES[this.status] ?? 'neutral';
  }

  get text(): string {
    return this.label ?? enumLabel(this.status);
  }
}
