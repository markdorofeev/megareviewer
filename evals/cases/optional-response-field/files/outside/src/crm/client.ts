export interface CrmClient {
  upsert(contact: {
    readonly externalId: string;
    readonly name: string;
    readonly email: string;
  }): Promise<void>;
}
