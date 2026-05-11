# next-charge

Token-bucket charge system for Next.js API routes backed by Redis. Prevents unbounded spend from public demos.

## Install

    pnpm add next-charge

## Quick start

### Define your charge system

    // lib/charge.ts
    import { createChargeSystem } from "next-charge";
    import { Redis } from "@upstash/redis";

    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });

    export const {
      withCharge,
      getChargeState,
      getAllChargeStates,
      topOff,
      checkCharges,
      chargeStatusHandler,
      checkHandler,
    } = createChargeSystem({
      redis,
      pools: [
        { id: "generate-image", maxCharges: 5, rechargeIntervalHours: 2 },
        { id: "describe-image", maxCharges: 20, rechargeIntervalHours: 0.5 },
      ],
    });

### Wrap your API routes

    // app/api/generate/route.ts
    import { withCharge } from "@/lib/charge";

    export const POST = withCharge("generate-image", async (req: Request) => {
      const body = await req.json();
      // ... your handler logic
      return Response.json({ success: true });
    });

When charges are depleted, the wrapper returns a 429 response:

    {
      "error": "out_of_charge",
      "retryAfterMs": 3600000,
      "poolId": "generate-image"
    }

A `Retry-After` header (in seconds) is also set.

If Redis is unreachable, the wrapper returns a 503 with `{ "error": "service_unavailable" }` (fail-closed).

### Add status endpoints (optional)

    // app/api/usage/route.ts
    import { chargeStatusHandler } from "@/lib/charge";

    export const GET = chargeStatusHandler();

    // app/api/usage/check/route.ts
    import { checkHandler } from "@/lib/charge";

    export const GET = checkHandler();

`GET /api/usage` returns all pool states. `GET /api/usage/check?pools=generate-image,describe-image` returns a quick availability check:

    { "ok": true, "pools": [{ "id": "generate-image", "available": true }, ...] }

## Client-side hook

    import { useChargeFetch } from "next-charge/client";

    const chargeFetch = useChargeFetch({
      onOutOfCharge: (body, retryStr) => {
        alert(`Out of charges for ${body.poolId}. Recharges in ${retryStr}.`);
      },
    });

    const res = await chargeFetch("/api/generate", { method: "POST", body: JSON.stringify(data) });

`useChargeFetch` wraps `fetch()` and intercepts 429 responses with `error: "out_of_charge"`. It calls your `onOutOfCharge` callback with the parsed body and a human-readable retry string (e.g. "45m", "2h 15m"). The original `Response` is still returned so you can handle other errors normally.

## Configuration

### `createChargeSystem(config)`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `redis` | `ChargeRedis` | required | Redis client instance |
| `pools` | `ChargePoolConfig[]` | required | Array of charge pool definitions |
| `keyPrefix` | `string` | `"charge:"` | Prefix for Redis keys |
| `devBypass` | `boolean` | `false` | Skip consumption (reads still work if Redis is available) |

### `ChargePoolConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `string` | required | Unique pool identifier |
| `maxCharges` | `number` | required | Maximum accumulated charges |
| `rechargeIntervalHours` | `number` | required | Hours to regenerate one charge |
| `label` | `string` | `id` | Human-readable label for status endpoints |
| `group` | `string` | `""` | Grouping key for dashboard sections |

## Redis compatibility

next-charge needs only three methods from your Redis client:

    interface ChargeRedis {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<unknown>;
      eval(script: string, keys: string[], args: string[]): Promise<unknown>;
    }

This is directly compatible with `@upstash/redis` and `@vercel/kv`. For `ioredis`, wrap with a thin adapter:

    import Redis from "ioredis";

    const raw = new Redis(process.env.REDIS_URL!);
    const redis = {
      get: (k: string) => raw.get(k),
      set: (k: string, v: string) => raw.set(k, v) as Promise<unknown>,
      eval: (script: string, keys: string[], args: string[]) =>
        raw.eval(script, keys.length, ...keys, ...args),
    };

## How it works

Each pool tracks `{ current, lastUpdatedAt }` in a single Redis key. Recharge is passive and time-based -- no background jobs or cron required.

On consume, an atomic Lua script computes how many charges have accumulated since `lastUpdatedAt`, adds them to `current` (capped at `maxCharges`), then decrements by one. If no charges are available, it returns `retryAfterMs` without writing.

`lastUpdatedAt` advances by exact interval multiples (not wall-clock time) to preserve partial recharge progress. A missing key initializes as full. Redis failures fail-closed (503). When `devBypass` is true, consumption always succeeds.

## License

MIT
