export interface PaymentClient {
  readonly charges: {
    create(input: {
      readonly amount: number;
      readonly currency: "usd";
      readonly orderId: string;
    }): Promise<{ readonly id: string }>;
  };
}
