// One-shot dev faucet. Not part of the HTTP gateway: Mint is chaincode-
// enforced admin-only (SmartContract.java, ~line 830) no matter which
// per-user gateway process is running, so this connects directly as the
// 'admin' identity instead of going through any single-tenant gateway.
//
// Usage: npx tsx src/cli/faucet.ts <userId> <amount>
import { withContract } from '../fabric';

async function main(): Promise<void> {
  const [userId, amountStr] = process.argv.slice(2);
  if (!userId || !amountStr) {
    console.error('usage: faucet.ts <userId> <amount>');
    process.exit(1);
  }

  await withContract('admin', (contract) => contract.submitTransaction('Mint', userId, amountStr));
  console.log(`minted ${amountStr} to ${userId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
