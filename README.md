# next-charge

Token-bucket charge system for API routes backed by Redis. Prevents unbounded spend from public-facing endpoints. Works with any framework that has a Redis client — Next.js, Hono, Express, Bun, Deno, SvelteKit, etc.

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

    export const charge = createChargeSystem({
      redis,
      pools: [
        { id: "generate-image", maxCharges: 5, rechargeIntervalHours: 2 },
        { id: "describe-image", maxCharges: 20, rechargeIntervalHours: 0.5 },
      ],
    });

### Use the engine directly

`consumeCharge` is the core primitive — call it from any context (route handler, queue worker, cron job, CLI):

    const result = await charge.consumeCharge("generate-image");

    if (!result.ok) {
      // result.retryAfterMs tells you when the next charge arrives
      throw new Error(`Rate limited, retry in ${result.retryAfterMs}ms`);
    }

    // proceed with expensive operation

Other engine methods:

    await charge.getChargeState("generate-image");   // read one pool
    await charge.getAllChargeStates();                 // read all pools
    await charge.checkCharges(["generate-image"]);    // quick availability check
    await charge.topOff("generate-image");             // admin: reset to full

### Route handler adapter (optional)

For frameworks using the standard Web `Request`/`Response` API (Next.js App Router, Hono, Bun.serve, Deno, etc.), `withCharge` wraps a handler to consume a charge before it runs:

    // Next.js App Router
    import { charge } from "@/lib/charge";

    export const POST = charge.withCharge("generate-image", async (req: Request) => {
      const body = await req.json();
      // ... your handler logic
      return Response.json({ success: true });
    });

    // Hono
    app.post("/api/generate", async (c) => {
      const handler = charge.withCharge("generate-image", async (req) => {
        // ... your handler logic
        return Response.json({ success: true });
      });
      return handler(c.req.raw);
    });

When charges are depleted, the wrapper returns a 429 response:

    {
      "error": "out_of_charge",
      "retryAfterMs": 3600000,
      "poolId": "generate-image"
    }

A `Retry-After` header (in seconds) is also set.

If Redis is unreachable, the wrapper returns a 503 with `{ "error": "service_unavailable" }` (fail-closed).

For Express or other non-standard-Request frameworks, call `consumeCharge` directly in your middleware.

### Status endpoints (optional)

Pre-built handlers for status and availability checks:

    // GET /api/usage — returns all pool states
    export const GET = charge.chargeStatusHandler();

    // GET /api/usage/check?pools=generate-image,describe-image — quick check
    export const GET = charge.checkHandler();

`GET /api/usage/check?pools=generate-image,describe-image` returns:

    { "ok": true, "pools": [{ "id": "generate-image", "available": true }, ...] }

## Client-side fetch wrapper

### Framework-agnostic (any JS environment)

    import { createChargeFetch } from "next-charge/fetch";

    const chargeFetch = createChargeFetch({
      onOutOfCharge: (body, retryStr) => {
        alert(`Out of charges for ${body.poolId}. Recharges in ${retryStr}.`);
      },
    });

    const res = await chargeFetch("/api/generate", { method: "POST", body: JSON.stringify(data) });

`createChargeFetch` wraps `fetch()` and intercepts 429 responses with `error: "out_of_charge"`. It calls your `onOutOfCharge` callback with the parsed body and a human-readable retry string (e.g. "45m", "2h 15m"). The original `Response` is still returned so you can handle other errors normally.

### React hook

    import { useChargeFetch } from "next-charge/client";

    const chargeFetch = useChargeFetch({
      onOutOfCharge: (body, retryStr) => {
        toast.error(`Out of charges. Recharges in ${retryStr}.`);
      },
    });

    const res = await chargeFetch("/api/generate", { method: "POST", body: JSON.stringify(data) });

Same behavior as `createChargeFetch`, wrapped in `useCallback` for stable identity across renders.

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
