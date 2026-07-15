/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.Context;
import org.hyperledger.fabric.shim.ChaincodeException;

/**
 * Balance read/write helpers.
 *
 * MVP limitation (documented per spec section 7): this is a simple mutable
 * balance updated in place. It is not safe under highly concurrent writes
 * to the same user's balance, since Fabric's MVCC will cause one of two
 * concurrent read-modify-write transactions on the same key to fail. A
 * post-MVP hardening would replace this with an event-sourced model:
 * immutable settlement entries keyed {@code {providerId}~{txId}}, with the
 * balance computed by aggregation instead of stored directly.
 */
public final class TokenLedger {

    private TokenLedger() { }

    /** Reads a user's balance, defaulting to 0 if never set. */
    public static long getBalance(final Context ctx, final String userId) {
        String key = ChaincodeUtil.balanceKey(ctx, userId);
        String raw = ctx.getStub().getStringState(key);
        if (raw == null || raw.isEmpty()) {
            return 0;
        }
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            throw new ChaincodeException("corrupt balance value for " + userId);
        }
    }

    /** Writes a user's balance. */
    public static void setBalance(final Context ctx, final String userId, final long balance) {
        ctx.getStub().putStringState(ChaincodeUtil.balanceKey(ctx, userId), Long.toString(balance));
    }

    /** Adds amount (must be &gt;= 0) to a user's balance. */
    public static void creditBalance(final Context ctx, final String userId, final long amount) {
        if (amount < 0) {
            throw new ChaincodeException("credit amount must not be negative");
        }
        setBalance(ctx, userId, getBalance(ctx, userId) + amount);
    }

    /** Subtracts amount (must be &gt;= 0) from a user's balance, failing if funds are insufficient. */
    public static void debitBalance(final Context ctx, final String userId, final long amount) {
        if (amount < 0) {
            throw new ChaincodeException("debit amount must not be negative");
        }
        long balance = getBalance(ctx, userId);
        if (balance < amount) {
            throw new ChaincodeException(
                    // "insufficient balance: " + userId + " has " + balance + ", needs " + amount);
                    "insufficient balance: " + userId);
        }
        setBalance(ctx, userId, balance - amount);
    }
}
