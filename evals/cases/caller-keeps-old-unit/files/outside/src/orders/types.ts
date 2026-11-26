export interface OrderLine {
  readonly unitPrice: number;
  readonly quantity: number;
}

export interface Order {
  readonly id: string;
  readonly taxRate: number;
  readonly lines: readonly OrderLine[];
}
