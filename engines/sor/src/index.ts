/**
 * Smart Order Router — choisit la destination d'exécution.
 * Ne connaît pas Trading : produit RoutingDecision (contrat).
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import type { OrderRequested, RoutingDecision } from "@aotc/contracts";

export class SorEngine extends BaseEngine {
  readonly name = "sor";

  protected async onStart(_ctx: EngineContext): Promise<void> {}
  protected async onStop(): Promise<void> {}

  async route(order: OrderRequested, referencePrice: number): Promise<RoutingDecision> {
    return {
      client_order_id: order.client_order_id,
      route: "internal_book",
      rationale: {
        criteria: ["best_execution_policy", "available_liquidity"],
        reference_price: referencePrice,
        expected_price: order.price_limit ?? referencePrice,
      },
    };
  }
}
