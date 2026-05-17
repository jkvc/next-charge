/**
 * Minimal Redis client interface.
 * Directly compatible with @upstash/redis and @vercel/kv.
 * For ioredis, wrap with a thin adapter (see README).
 */
export interface ChargeRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export interface ChargePoolConfig {
  /** Unique identifier for this pool. */
  id: string;
  /** Maximum accumulated charges. */
  maxCharges: number;
  /** Hours to regenerate 1 charge. */
  rechargeIntervalHours: number;
  /** Human-readable label (used by status handler). */
  label?: string;
  /** Grouping key for dashboard sections (used by status handler). */
  group?: string;
}

export interface StoredCharge {
  current: number;
  lastUpdatedAt: number;
}

export interface RechargeResult {
  current: number;
  lastUpdatedAt: number;
  retryAfterMs?: number;
}

export interface ChargeState {
  id: string;
  label: string;
  group: string;
  current: number;
  max: number;
  rechargeIntervalHours: number;
  nextRechargeAt: number | null;
  fullAt: number | null;
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

export interface CheckResult {
  ok: boolean;
  pools: { id: string; available: boolean }[];
}

export interface ChargeSystemConfig {
  redis: ChargeRedis;
  pools: ChargePoolConfig[];
  /** Redis key prefix. Default: "charge:" */
  keyPrefix?: string;
  /** Bypass charge consumption (reads still work if Redis is available). Default: false */
  devBypass?: boolean;
}

/** Core engine — framework-agnostic, works anywhere with Redis. */
export interface ChargeEngine {
  consumeCharge: (poolId: string) => Promise<ConsumeResult>;
  getChargeState: (poolId: string) => Promise<ChargeState>;
  getAllChargeStates: () => Promise<ChargeState[]>;
  topOff: (poolId: string) => Promise<void>;
  checkCharges: (poolIds: string[]) => Promise<CheckResult>;
  pools: ChargePoolConfig[];
}

/** Web Request/Response route handler adapters (work with Next.js, Hono, Bun, Deno, etc.). */
export interface ChargeHandlers {
  withCharge: (
    poolId: string,
    handler: (req: Request) => Promise<Response>,
  ) => (req: Request) => Promise<Response>;
  chargeStatusHandler: () => (req: Request) => Promise<Response>;
  checkHandler: () => (req: Request) => Promise<Response>;
}

/** Full system returned by createChargeSystem — engine + route handler adapters. */
export interface ChargeSystem extends ChargeEngine, ChargeHandlers {}
