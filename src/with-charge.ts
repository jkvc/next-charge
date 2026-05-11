import type { ConsumeResult } from "./types";

export function createWithCharge(
  consumeCharge: (poolId: string) => Promise<ConsumeResult>,
) {
  return function withCharge(
    poolId: string,
    handler: (req: Request) => Promise<Response>,
  ) {
    return async (req: Request): Promise<Response> => {
      let result: ConsumeResult;
      try {
        result = await consumeCharge(poolId);
      } catch (err) {
        console.error(`[next-charge] Redis error for ${poolId}:`, err);
        return Response.json(
          { error: "service_unavailable", message: "Charge system unavailable" },
          { status: 503 },
        );
      }

      if (!result.ok) {
        return Response.json(
          { error: "out_of_charge", retryAfterMs: result.retryAfterMs, poolId },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
            },
          },
        );
      }

      return handler(req);
    };
  };
}
