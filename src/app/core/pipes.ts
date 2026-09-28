import { Pipe, PipeTransform, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { enumLabel } from './enums';
import { DateStyle, formatDate, formatMoney } from './format';

/** {{ order.grandTotal | money }} → "$15.79" (input is cents). */
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  private auth = inject(AuthService);

  transform(cents: number | null | undefined, currency?: string): string {
    return formatMoney(cents, currency || this.auth.currency(), this.auth.locale());
  }
}

/** {{ order.createdAt | tzDate:'datetime' }}, shown in the restaurant's timezone. */
@Pipe({ name: 'tzDate', standalone: true, pure: false })
export class TzDatePipe implements PipeTransform {
  private auth = inject(AuthService);

  transform(value: string | Date | null | undefined, style: DateStyle = 'datetime'): string {
    return formatDate(value, style, this.auth.timezone(), this.auth.locale());
  }
}

/** {{ 'inventory_clerk' | label }} → "Inventory clerk". */
@Pipe({ name: 'label', standalone: true })
export class LabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return enumLabel(value);
  }
}
