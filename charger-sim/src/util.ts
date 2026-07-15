import { GatewayError } from '@hyperledger/fabric-gateway';

/** Strips Fabric's "chaincode response <code>, " wrapper, leaving just the ChaincodeException message. */
function unwrapChaincodeMessage(message: string): string {
  return message.replace(/^chaincode response \d+,\s*/, '');
}

/**
 * Fabric wraps the real cause (the chaincode's rejection message) per-peer
 * in GatewayError.details; err.message alone is just the generic gRPC
 * status ("10 ABORTED: failed to endorse transaction..."). Mirrors
 * gateway/src/routes/util.ts's errorMiddleware so this daemon's admin API
 * and console logs surface the actual reason instead of the generic status.
 */
export function describeError(err: unknown): string {
  if (err instanceof GatewayError && err.details.length > 0) {
    return err.details.map((detail) => unwrapChaincodeMessage(detail.message)).join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}
