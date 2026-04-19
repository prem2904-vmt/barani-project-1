import { Pipe, PipeTransform } from '@angular/core';

export type TatLevel = 'urgent' | 'high' | 'normal';

@Pipe({ name: 'tatColor', standalone: true })
export class TatColorPipe implements PipeTransform {
  transform(level: TatLevel | string | null | undefined): string {
    switch (level) {
      case 'urgent': return 'bg-red-50 text-red-700 border-red-200';
      case 'high':   return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'normal': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default:       return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  }
}
