/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import java.security.cert.X509Certificate;

import javax.naming.ldap.LdapName;
import javax.naming.ldap.Rdn;

import org.hyperledger.fabric.contract.Context;
import org.hyperledger.fabric.shim.ChaincodeException;
import org.hyperledger.fabric.shim.ChaincodeStub;

import com.owlike.genson.Genson;

/** Shared helpers: caller identity, composite keys, and JSON (de)serialization. */
public final class ChaincodeUtil {

    private ChaincodeUtil() { }

    private static final Genson GENSON = new Genson();

    /**
     * Derives the calling user's ID from their X.509 certificate's
     * CommonName. This works because each pre-enrolled MVP identity
     * (admin/alice/bob/provider1/...) is issued its own certificate with a
     * distinct CN by the Fabric CA.
     */
    public static String getCallerID(final Context ctx) {
        X509Certificate cert = ctx.getClientIdentity().getX509Certificate();
        if (cert == null) {
            throw new ChaincodeException("failed to read caller certificate");
        }
        try {
            LdapName ldapName = new LdapName(cert.getSubjectX500Principal().getName());
            for (Rdn rdn : ldapName.getRdns()) {
                if ("CN".equalsIgnoreCase(rdn.getType())) {
                    return rdn.getValue().toString();
                }
            }
        } catch (javax.naming.InvalidNameException e) {
            throw new ChaincodeException("failed to parse caller certificate subject: " + e.getMessage());
        }
        throw new ChaincodeException("caller certificate has no CommonName");
    }

    public static String userKey(final Context ctx, final String userId) {
        return ctx.getStub().createCompositeKey("user", userId).toString();
    }

    public static String providerKey(final Context ctx, final String providerId) {
        return ctx.getStub().createCompositeKey("provider", providerId).toString();
    }

    public static String slotKey(final Context ctx, final String providerId, final String slotId) {
        return ctx.getStub().createCompositeKey("slot", providerId, slotId).toString();
    }

    public static String reservationKey(final Context ctx, final String reservationId) {
        return ctx.getStub().createCompositeKey("reservation", reservationId).toString();
    }

    public static String sessionKey(final Context ctx, final String sessionId) {
        return ctx.getStub().createCompositeKey("session", sessionId).toString();
    }

    public static String balanceKey(final Context ctx, final String userId) {
        return ctx.getStub().createCompositeKey("balance", userId).toString();
    }

    public static String chargerKey(final Context ctx, final String chargerId) {
        return ctx.getStub().createCompositeKey("charger", chargerId).toString();
    }

    /** seq is zero-padded to 6 digits so lexicographic and numeric ordering agree. */
    public static String readingKey(final Context ctx, final String sessionId, final int seq) {
        return ctx.getStub().createCompositeKey("reading", sessionId, String.format("%06d", seq)).toString();
    }

    public static String malfunctionKey(final Context ctx, final String sessionId) {
        return ctx.getStub().createCompositeKey("malfunction", sessionId).toString();
    }

    /** Floors a unix-seconds timestamp to the containing booking bucket's start. */
    public static long floorToBucket(final long unixSeconds) {
        return (unixSeconds / Constants.BOOKING_BUCKET_SECONDS) * Constants.BOOKING_BUCKET_SECONDS;
    }

    /** bucketStart is zero-padded to 12 digits so GetStateByRange orders buckets lexicographically = numerically. */
    public static String bookingKey(final Context ctx, final String providerId, final String slotId, final long bucketStart) {
        return ctx.getStub().createCompositeKey("booking", providerId, slotId, String.format("%012d", bucketStart)).toString();
    }

    /** Marshals v and writes it to the given key. */
    public static void putJSON(final Context ctx, final String key, final Object v) {
        ctx.getStub().putStringState(key, GENSON.serialize(v));
    }

    /** Reads the given key and unmarshals it. Throws if the key does not exist. */
    public static <T> T getJSON(final Context ctx, final String key, final Class<T> type) {
        String json = ctx.getStub().getStringState(key);
        if (json == null || json.isEmpty()) {
            throw new ChaincodeException("no state found for key " + key);
        }
        return GENSON.deserialize(json, type);
    }

    /** Serializes a value (e.g. a List) to a JSON string, for list-returning transactions. */
    public static String toJSON(final Object v) {
        return GENSON.serialize(v);
    }

    /** Parses an arbitrary JSON string (e.g. a request DTO) into type. */
    public static <T> T fromJSON(final String json, final Class<T> type) {
        try {
            return GENSON.deserialize(json, type);
        } catch (RuntimeException e) {
            throw new ChaincodeException("invalid JSON: " + e.getMessage());
        }
    }

    /** Current transaction time, seconds since epoch (deterministic across peers). */
    public static long txNow(final Context ctx) {
        return ctx.getStub().getTxTimestamp().getEpochSecond();
    }

    /**
     * Marshals v and writes it to key in a private data collection
     * (TRIP_RESERVATION_ADDENDUM.md section 7). Fabric stores only
     * hash(key)/hash(value) for private data on the public ledger; the
     * cleartext lives solely in the collection, replicated only to its
     * member orgs' peers.
     */
    public static void putPrivateJSON(final Context ctx, final String collection, final String key, final Object v) {
        ctx.getStub().putPrivateData(collection, key, GENSON.serialize(v));
    }

    /** Reads and unmarshals a private data collection entry. Throws if the key does not exist. */
    public static <T> T getPrivateJSON(final Context ctx, final String collection, final String key, final Class<T> type) {
        String json = ctx.getStub().getPrivateDataUTF8(collection, key);
        if (json == null || json.isEmpty()) {
            throw new ChaincodeException("no private state found for key " + key + " in collection " + collection);
        }
        return GENSON.deserialize(json, type);
    }

    /** Reads a byte[] value out of a transaction's transient map, or throws a clear error if absent. */
    public static byte[] getTransientOrThrow(final Context ctx, final String field) {
        byte[] v = ctx.getStub().getTransient().get(field);
        if (v == null || v.length == 0) {
            throw new ChaincodeException("transient field '" + field + "' is required");
        }
        return v;
    }

    public static ChaincodeStub stub(final Context ctx) {
        return ctx.getStub();
    }
}
