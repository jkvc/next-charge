import type { ChargeState, CheckResult } from "./types";

export function createStatusHandler(
  getAllChargeStates: () => Promise<ChargeState[]>,
) {
  return function chargeStatusHandler() {
    return async (_req: Request): Promise<Response> => {
      try {
        const states = await getAllChargeStates();
        return Response.json({ pools: states });
      } catch (err) {
        console.error("[next-charge] Failed to fetch charge states:", err);
        return Response.json(
          { error: "service_unavailable" },
          { status: 503 },
        );
      }
    };
  };
}

export function createCheckHandler(
  checkCharges: (poolIds: string[]) => Promise<CheckResult>,
) {
  return function checkHandler() {
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const poolsParam = url.searchParams.get("pools");

      if (!poolsParam) {
        return Response.json(
          { error: "Missing ?pools= query parameter" },
          { status: 400 },
        );
      }

      const poolIds = poolsParam.split(",").filter(Boolean);
      if (poolIds.length === 0) {
        return Response.json(
          { error: "No pool IDs provided" },
          { status: 400 },
        );
      }

      try {
        const result = await checkCharges(poolIds);
        return Response.json(result);
      } catch (err) {
        console.error("[next-charge] Check failed:", err);
        return Response.json(
          { error: "service_unavailable" },
          { status: 503 },
        );
      }
    };
  };
}
