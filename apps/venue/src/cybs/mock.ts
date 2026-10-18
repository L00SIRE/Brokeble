// CYBS_MODE=mock: deterministic stand-in. Outcome comes from the mock-only bill_to.first_name.
import { randomBytes } from "node:crypto";
import type { CybsService } from "./service";

const mockId = (p: string) => `mock_${p}_${randomBytes(6).toString("hex")}`;

export const mockCybs: CybsService = {
  async captureContext() {
    return { jwt: "mock", clientLibrary: "", clientLibraryIntegrity: "" };
  },
  async authorize(a) {
    const n = a.billTo.first_name.toLowerCase();
    if (n === "timeout") return { kind: "unknown", http: null, code: "ETIMEDOUT" };
    if (n === "decline") return { kind: "ok", http: 201, data: { id: mockId("pay"), status: "DECLINED", errorInformation: { reason: "PROCESSOR_DECLINED" } } };
    return {
      kind: "ok",
      http: 201,
      data: {
        id: mockId("pay"),
        status: "AUTHORIZED",
        paymentAccountInformation: { card: { suffix: "1111", type: "001" } },
        ...(a.saveCard ? { tokenInformation: { customer: { id: mockId("cus") }, paymentInstrument: { id: mockId("pi") } } } : {}),
      },
    };
  },
  async capture() {
    return { kind: "ok", http: 201, data: { id: mockId("cap"), status: "PENDING" } };
  },
  async reverse() {
    return { kind: "ok", http: 201, data: { id: mockId("rev"), status: "REVERSED" } };
  },
  async timeoutReverse() {
    return { kind: "ok", http: 201, data: { id: mockId("rev"), status: "REVERSED" } };
  },
  async getTransaction(id) {
    return { kind: "ok", http: 200, data: { id, applicationInformation: { status: "mock" } } };
  },
};
