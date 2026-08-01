/**
 * Market Data Service — publication ticks / candles + simulateur sandbox.
 */

import { BaseEngine, type EngineContext } from "@aotc/core";
import { TOPICS, createEnvelope, type PriceTick } from "@aotc/contracts";

export type SimulatorInstrument = {
  asset_id: string;
  instrument_id: string;
  symbol: string;
  last: number;
  tick_size: number;
  exchange_id?: string;
};

export type SimulatorOpts = {
  intervalMs?: number;
  /** Amplitude max en ticks (±). */
  maxTickMove?: number;
};

export class MarketDataEngine extends BaseEngine {
  readonly name = "marketdata";
  private timer: ReturnType<typeof setInterval> | null = null;
  private instruments: SimulatorInstrument[] = [];
  private lastTicks = new Map<string, PriceTick>();
  private opts: Required<SimulatorOpts> = {
    intervalMs: 2_000,
    maxTickMove: 3,
  };

  protected async onStart(_ctx: EngineContext): Promise<void> {}

  protected async onStop(): Promise<void> {
    this.stopSimulator();
  }

  async publishTick(tick: PriceTick, correlationId: string): Promise<void> {
    if (!this.ctx) throw new Error("MarketDataEngine not started");
    this.lastTicks.set(tick.asset_id, tick);
    await this.ctx.bus.publish(
      TOPICS.MARKETDATA_TICK,
      createEnvelope({
        type: "PriceTick",
        correlation_id: correlationId,
        environment: this.ctx.environment,
        payload: tick,
      }),
    );
  }

  startSimulator(
    instruments: SimulatorInstrument[],
    opts?: SimulatorOpts,
  ): void {
    this.stopSimulator();
    this.instruments = instruments.map((i) => ({ ...i }));
    this.opts = {
      intervalMs: opts?.intervalMs ?? 2_000,
      maxTickMove: opts?.maxTickMove ?? 3,
    };
    for (const inst of this.instruments) {
      const tick: PriceTick = {
        asset_id: inst.asset_id,
        instrument_id: inst.instrument_id,
        exchange_id: inst.exchange_id,
        last: inst.last,
        mid: inst.last,
        ts: new Date().toISOString(),
        source: "aotc_computed",
      };
      this.lastTicks.set(inst.asset_id, tick);
    }
    const timer = setInterval(() => {
      void this.tickOnce();
    }, this.opts.intervalMs);
    // Ne bloque pas la sortie du process (tests / CLI)
    timer.unref?.();
    this.timer = timer;
  }

  stopSimulator(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLastTicks(): PriceTick[] {
    return [...this.lastTicks.values()];
  }

  private async tickOnce(): Promise<void> {
    if (!this.ctx) return;
    for (const inst of this.instruments) {
      const move =
        (Math.floor(Math.random() * (this.opts.maxTickMove * 2 + 1)) -
          this.opts.maxTickMove) *
        inst.tick_size;
      inst.last = Math.max(inst.tick_size, inst.last + move);
      const tick: PriceTick = {
        asset_id: inst.asset_id,
        instrument_id: inst.instrument_id,
        exchange_id: inst.exchange_id,
        last: inst.last,
        mid: inst.last,
        ts: new Date().toISOString(),
        source: "aotc_computed",
      };
      try {
        await this.publishTick(tick, crypto.randomUUID());
      } catch {
        /* ignore si stop pendant tick */
      }
    }
  }
}
