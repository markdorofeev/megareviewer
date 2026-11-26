export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly lastOrderAt: Date | null;
}
