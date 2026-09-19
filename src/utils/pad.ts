/** Zero-pad a number to two digits. Shared so every date formatter pads alike. */
export function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}
