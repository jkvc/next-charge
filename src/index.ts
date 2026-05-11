import { createEngine, computeRecharge } from "./engine";
import { createWithCharge } from "./with-charge";
import { createStatusHandler, createCheckHandler } from "./status-handler";
import type { ChargeSystem, ChargeSystemConfig } from "./types";

export function createChargeSystem(config: ChargeSystemConfig): ChargeSystem {
  const keyPrefix = config.keyPrefix ?? "charge:";
  const devBypass = config.devBypass ?? false;

  const engine = createEngine(config.redis, config.pools, keyPrefix, devBypass);
  const withCharge = createWithCharge(engine.consumeCharge);
  const chargeStatusHandler = createStatusHandler(engine.getAllChargeStates);
  const checkHandler = createCheckHandler(engine.checkCharges);

  return {
    ...engine,
    withCharge,
    chargeStatusHandler,
    checkHandler,
    pools: config.pools,
  };
}

export { computeRecharge } from "./engine";

export type {
  ChargeRedis,
  ChargePoolConfig,
  ChargeState,
  ChargeSystem,
  ChargeSystemConfig,
  ConsumeResult,
  CheckResult,
  StoredCharge,
  RechargeResult,
} from "./types";
