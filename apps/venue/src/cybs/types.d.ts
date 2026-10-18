// The Cybersource SDK ships no types. Only the surface we call is declared (verified in 0.0.84 src/api/*.js).
declare module "cybersource-rest-client" {
  type Cb<T = any> = (error: any, data: T, response: any) => void;
  export class ApiClient {
    timeout: number;
  }
  export class PaymentsApi {
    constructor(config: unknown, client: ApiClient);
    createPayment(body: unknown, cb: Cb): void;
  }
  export class CaptureApi {
    constructor(config: unknown, client: ApiClient);
    capturePayment(body: unknown, id: string, cb: Cb): void;
  }
  export class ReversalApi {
    constructor(config: unknown, client: ApiClient);
    authReversal(id: string, body: unknown, cb: Cb): void;
    mitReversal(body: unknown, cb: Cb): void;
  }
  export class TransactionDetailsApi {
    constructor(config: unknown, client: ApiClient);
    getTransaction(id: string, cb: Cb): void;
  }
  export class MicroformIntegrationApi {
    constructor(config: unknown, client: ApiClient);
    generateCaptureContext(body: unknown, cb: Cb<string>): void;
  }
  const cybs: {
    ApiClient: typeof ApiClient;
    PaymentsApi: typeof PaymentsApi;
    CaptureApi: typeof CaptureApi;
    ReversalApi: typeof ReversalApi;
    TransactionDetailsApi: typeof TransactionDetailsApi;
    MicroformIntegrationApi: typeof MicroformIntegrationApi;
  };
  export default cybs;
}
