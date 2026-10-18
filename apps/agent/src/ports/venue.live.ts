// VENUE_MODE=live. Owner C: implement here or in src/venueClient/index.ts and re-export it from this file
// (TAP-signed fetch; PLAN §8 TAP format, §18; docs/plans/C-trust-commerce.md T5).
import type { CommitResult, ConsentSet, CreateOrderRequest, CreateOrderResponse, OrderStatus } from "@tab/shared";
import type { TapTestKind, VenuePort } from "./types";
import { notImplemented } from "./notImplemented";

export class LiveVenue implements VenuePort {
  async checkAvailability(_bundleKey: string): Promise<{ available: boolean }> {
    return notImplemented("LiveVenue.checkAvailability", "C");
  }
  async createOrder(_req: CreateOrderRequest): Promise<CreateOrderResponse> {
    return notImplemented("LiveVenue.createOrder", "C");
  }
  async getOrder(_orderId: string): Promise<OrderStatus> {
    return notImplemented("LiveVenue.getOrder", "C");
  }
  async commit(_orderId: string, _consent: ConsentSet, _test?: TapTestKind): Promise<CommitResult> {
    return notImplemented("LiveVenue.commit", "C");
  }
  async cancel(_orderId: string, _reason: string): Promise<OrderStatus> {
    return notImplemented("LiveVenue.cancel", "C");
  }
}
