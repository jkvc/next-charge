import { describe, it, expect, beforeEach } from "vitest";
import { createChargeSystem } from "../src/index";
import type { ChargeRedis, ChargePoolConfig } from "../src/types";

const TEST_POOLS: ChargePoolConfig[] = [
  { id: "test-a", maxCharges: 10, rechargeIntervalHours: 1 },
];

function createMockRedis(luaResult?: unknown, shouldThrow = false) {
  const redis: ChargeRedis = {
    get: async () => null,
    set: async () => "OK",
    eval: async () => {
      if (shouldThrow) throw new Error("Redis connection refused");
      return typeof luaResult === "string" ? luaResult : JSON.stringify(luaResult);
    },
  };
  return redis;
}

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/test", { method: "POST" });
}

describe("withCharge", () => {
  it("calls handler when charge is available", async () => {
    const redis = createMockRedis({ ok: true });
    const { withCharge } = createChargeSystem({ redis, pools: TEST_POOLS });

    let handlerCalled = false;
    const handler = async () => {
      handlerCalled = true;
      return Response.json({ success: true });
    };

    const wrapped = withCharge("test-a", handler);
    const response = await wrapped(makeRequest());

    expect(handlerCalled).toBe(true);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("returns 429 with out_of_charge when depleted", async () => {
    const redis = createMockRedis({ ok: false, retryAfterMs: 1_800_000 });
    const { withCharge } = createChargeSystem({ redis, pools: TEST_POOLS });

    let handlerCalled = false;
    const wrapped = withCharge("test-a", async () => {
      handlerCalled = true;
      return Response.json({});
    });

    const response = await wrapped(makeRequest());

    expect(handlerCalled).toBe(false);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("out_of_charge");
    expect(body.retryAfterMs).toBe(1_800_000);
    expect(body.poolId).toBe("test-a");
    expect(response.headers.get("Retry-After")).toBe("1800");
  });

  it("returns 503 when Redis is unreachable (fail-closed)", async () => {
    const redis = createMockRedis(null, true);
    const { withCharge } = createChargeSystem({ redis, pools: TEST_POOLS });

    let handlerCalled = false;
    const wrapped = withCharge("test-a", async () => {
      handlerCalled = true;
      return Response.json({});
    });

    const response = await wrapped(makeRequest());

    expect(handlerCalled).toBe(false);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("service_unavailable");
  });
});
