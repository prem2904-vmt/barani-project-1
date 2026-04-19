import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'inr', standalone: true })
export class CurrencyInrPipe implements PipeTransform {
  private readonly fmt = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  });
  transform(value: number | string | null | undefined): string {
    if (value == null || value === '') return '';
    const n = typeof value === 'string' ? Number(value) : value;
    if (Number.isNaN(n)) return '';
    return this.fmt.format(n);
  }
}
