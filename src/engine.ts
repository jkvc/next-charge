import type {
  ChargeRedis,
  ChargePoolConfig,
  StoredCharge,
  RechargeResult,
  ChargeState,
  ConsumeResult,
  CheckResult,
} from "./types";

// ---------------------------------------------------------------------------
// Pure recharge math — shared between TypeScript reads and Lua writes
// ---------------------------------------------------------------------------

export function computeRecharge(
  stored: StoredCharge | null,
  maxCharges: number,
  rechargeIntervalMs: number,
  now: number,
): RechargeResult {
  if (!stored) {
    return { current: maxCharges, lastUpdatedAt: now };
  }

  const elapsed = now - stored.lastUpdatedAt;
  const rechargesEarned = Math.floor(elapsed / rechargeIntervalMs);
  const effectiveCurrent = Math.min(
    stored.current + rechargesEarned,
    maxCharges,
  );

  if (effectiveCurrent >= maxCharges) {
    return { current: maxCharges, lastUpdatedAt: now };
  }

  const newLastUpdatedAt =
    rechargesEarned > 0
      ? stored.lastUpdatedAt + rechargesEarned * rechargeIntervalMs
      : stored.lastUpdatedAt;

  const retryAfterMs =
    effectiveCurrent < 1
      ? rechargeIntervalMs - (elapsed % rechargeIntervalMs)
      : undefined;

  return {
    current: effectiveCurrent,
    lastUpdatedAt: newLastUpdatedAt,
    retryAfterMs,
  };
}

// ---------------------------------------------------------------------------
// Lua script for atomic consume
// ---------------------------------------------------------------------------

const CONSUME_LUA = `
local key = KEYS[1]
local maxCharges = tonumber(ARGV[1])
local intervalMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local raw = redis.call("GET", key)
local current, lastUpdatedAt

if raw then
  local data = cjson.decode(raw)
  current = tonumber(data.current)
  lastUpdatedAt = tonumber(data.lastUpdatedAt)
else
  current = maxCharges
  lastUpdatedAt = now
end

local elapsed = now - lastUpdatedAt
local rechargesEarned = math.floor(elapsed / intervalMs)
local effectiveCurrent = math.min(current + rechargesEarned, maxCharges)

if effectiveCurrent < 1 then
  local retryAfterMs = intervalMs - (elapsed % intervalMs)
  return cjson.encode({ok = false, retryAfterMs = retryAfterMs})
end

local newCurrent = effectiveCurrent - 1
local newLastUpdatedAt
if effectiveCurrent >= maxCharges then
  newLastUpdatedAt = now
elseif rechargesEarned > 0 then
  newLastUpdatedAt = lastUpdatedAt + rechargesEarned * intervalMs
else
  newLastUpdatedAt = lastUpdatedAt
end

redis.call("SET", key, cjson.encode({current = newCurrent, lastUpdatedAt = newLastUpdatedAt}))
return cjson.encode({ok = true})
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hoursToMs(hours: number): number {
  return hours * 3_600_000;
}

// ---------------------------------------------------------------------------
// Engine factory — creates bound functions closed over redis + pools
// ---------------------------------------------------------------------------

export function createEngine(
  redis: ChargeRedis,
  pools: ChargePoolConfig[],
  keyPrefix: string,
  devBypass: boolean,
) {
  const poolMap = new Map(pools.map((p) => [p.id, p]));

  function resolvePool(poolId: string): ChargePoolConfig {
    const pool = poolMap.get(poolId);
    if (!pool) throw new Error(`[next-charge] Unknown pool: ${poolId}`);
    return pool;
  }

  function chargeKey(poolId: string): string {
    return `${keyPrefix}${poolId}`;
  }

  function toChargeState(
    pool: ChargePoolConfig,
    recharged: RechargeResult,
    intervalMs: number,
  ): ChargeState {
    const isFull = recharged.current >= pool.maxCharges;
    const deficit = pool.maxCharges - recharged.current;
    return {
      id: pool.id,
      label: pool.label ?? pool.id,
      group: pool.group ?? "",
      current: recharged.current,
      max: pool.maxCharges,
      rechargeIntervalHours: pool.rechargeIntervalHours,
      nextRechargeAt: isFull ? null : recharged.lastUpdatedAt + intervalMs,
      fullAt: isFull ? null : recharged.lastUpdatedAt + deficit * intervalMs,
    };
  }

  function syntheticFullState(pool: ChargePoolConfig): ChargeState {
    return {
      id: pool.id,
      label: pool.label ?? pool.id,
      group: pool.group ?? "",
      current: pool.maxCharges,
      max: pool.maxCharges,
      rechargeIntervalHours: pool.rechargeIntervalHours,
      nextRechargeAt: null,
      fullAt: null,
    };
  }

  async function getChargeStateFromRedis(
    pool: ChargePoolConfig,
    intervalMs: number,
  ): Promise<ChargeState> {
    const raw = await redis.get(chargeKey(pool.id));
    const now = Date.now();
    const stored: StoredCharge | null = raw ? JSON.parse(raw) : null;
    const recharged = computeRecharge(stored, pool.maxCharges, intervalMs, now);
    return toChargeState(pool, recharged, intervalMs);
  }

  // --- Public API ---

  async function getChargeState(poolId: string): Promise<ChargeState> {
    const pool = resolvePool(poolId);
    const intervalMs = hoursToMs(pool.rechargeIntervalHours);

    if (devBypass) {
      try {
        return await getChargeStateFromRedis(pool, intervalMs);
      } catch {
        return syntheticFullState(pool);
      }
    }

    return getChargeStateFromRedis(pool, intervalMs);
  }

  async function getAllChargeStates(): Promise<ChargeState[]> {
    if (devBypass) {
      try {
        return await Promise.all(
          pools.map((p) =>
            getChargeStateFromRedis(p, hoursToMs(p.rechargeIntervalHours)),
          ),
        );
      } catch {
        return pools.map(syntheticFullState);
      }
    }

    return Promise.all(
      pools.map((p) =>
        getChargeStateFromRedis(p, hoursToMs(p.rechargeIntervalHours)),
      ),
    );
  }

  async function consumeCharge(poolId: string): Promise<ConsumeResult> {
    const pool = resolvePool(poolId);

    if (devBypass) {
      return { ok: true };
    }

    const intervalMs = hoursToMs(pool.rechargeIntervalHours);
    const now = Date.now();

    const raw = await redis.eval(
      CONSUME_LUA,
      [chargeKey(pool.id)],
      [String(pool.maxCharges), String(intervalMs), String(now)],
    );

    return JSON.parse(raw as string) as ConsumeResult;
  }

  async function topOff(poolId: string): Promise<void> {
    const pool = resolvePool(poolId);
    const data: StoredCharge = {
      current: pool.maxCharges,
      lastUpdatedAt: Date.now(),
    };
    await redis.set(chargeKey(pool.id), JSON.stringify(data));
  }

  async function checkCharges(poolIds: string[]): Promise<CheckResult> {
    const states = await Promise.all(poolIds.map((id) => getChargeState(id)));
    const result = states.map((s) => ({ id: s.id, available: s.current >= 1 }));
    return {
      ok: result.every((p) => p.available),
      pools: result,
    };
  }

  return { getChargeState, getAllChargeStates, consumeCharge, topOff, checkCharges };
}
