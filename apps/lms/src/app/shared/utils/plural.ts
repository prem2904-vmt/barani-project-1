/** "1 sample", "2 samples", "1 case", "0 items". Pass `many` for irregular
 *  plurals ("1 person" / "2 people"). */
export function plural(n: number, one: string, many: string = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}
