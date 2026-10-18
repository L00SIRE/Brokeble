export type CybsOutcome<T> =
  | { kind: "ok"; http: number; data: T }
  | { kind: "rejected"; http: number; body: unknown } // definitive 4xx
  | { kind: "unknown"; http: number | null; code?: string }; // 5xx / timeout / network / decrypt: NEVER blind-retry

export type BillTo = {
  first_name: string;
  last_name: string;
  postal_code: string;
  email?: string;
  address1?: string;
  locality?: string;
  administrativeArea?: string;
};

export type AuthResp = {
  id?: string;
  status?: string;
  errorInformation?: { reason?: string; message?: string };
  tokenInformation?: { customer?: { id?: string }; paymentInstrument?: { id?: string } };
  paymentAccountInformation?: { card?: { suffix?: string; type?: string } };
  paymentInformation?: { card?: { suffix?: string; type?: string } };
};

export type AuthorizeArgs = {
  code: string;
  transactionId: string;
  amountCents: number;
  billTo: BillTo;
  transientTokenJwt?: string;
  saveCard: boolean;
  customerId?: string;
  sandboxTestCard?: boolean;
};

export interface CybsService {
  captureContext(): Promise<{ jwt: string; clientLibrary: string; clientLibraryIntegrity: string }>;
  authorize(a: AuthorizeArgs): Promise<CybsOutcome<AuthResp>>;
  capture(paymentId: string, code: string, amountCents: number): Promise<CybsOutcome<any>>;
  reverse(paymentId: string, code: string, amountCents: number, reason: string): Promise<CybsOutcome<any>>;
  timeoutReverse(code: string, origTransactionId: string, amountCents: number, reason: string): Promise<CybsOutcome<any>>;
  getTransaction(id: string): Promise<CybsOutcome<any>>;
}
