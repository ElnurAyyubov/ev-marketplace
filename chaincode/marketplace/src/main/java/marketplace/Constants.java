/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

/** Doc type discriminators and enum-like string constants shared across the contract. */
public final class Constants {

    private Constants() { }

    // Doc type discriminators, stored on every world-state record so CouchDB
    // selector queries can filter by type.
    public static final String DOC_TYPE_USER = "user";
    public static final String DOC_TYPE_PROVIDER = "provider";
    public static final String DOC_TYPE_SLOT = "slot";
    public static final String DOC_TYPE_RESERVATION = "reservation";
    public static final String DOC_TYPE_SESSION = "session";
    public static final String DOC_TYPE_CHARGER = "charger";
    public static final String DOC_TYPE_READING = "reading";
    public static final String DOC_TYPE_MALFUNCTION = "malfunction";

    // Provider types. Left open-ended (plain string) so future kinds
    // (hotel, mall, workplace, ...) can be added without a contract change.
    public static final String PROVIDER_TYPE_COMMERCIAL = "Commercial";
    public static final String PROVIDER_TYPE_RESIDENTIAL = "Residential";

    public static final String PROVIDER_STATUS_ACTIVE = "Active";
    public static final String PROVIDER_STATUS_INACTIVE = "Inactive";

    // Reservation state machine states.
    public static final String RESERVATION_STATE_REQUESTED = "REQUESTED";
    public static final String RESERVATION_STATE_CONFIRMED = "CONFIRMED";
    public static final String RESERVATION_STATE_ACTIVE = "ACTIVE";
    public static final String RESERVATION_STATE_COMPLETED = "COMPLETED";
    public static final String RESERVATION_STATE_CANCELLED = "CANCELLED";
    public static final String RESERVATION_STATE_EXPIRED = "EXPIRED";

    // Session states. Addendum A section 5.2: the entire machine is
    // ACTIVE -> SETTLED; SETTLED_PENDING/RELEASED/DISPUTED/RESOLVED/ESCALATED
    // from the base spec are removed.
    public static final String SESSION_STATE_ACTIVE = "Active";
    public static final String SESSION_STATE_SETTLED = "Settled";

    // Charger status.
    public static final String CHARGER_STATUS_ACTIVE = "Active";
    public static final String CHARGER_STATUS_INACTIVE = "Inactive";

    // How long a REQUESTED reservation (awaiting residential-owner approval)
    // stays valid before it can be expired.
    public static final long RESERVATION_TIMEOUT_SECONDS = 15 * 60;

    // How long a CONFIRMED reservation (escrow/hold locked, awaiting the
    // bound charger to start the session -- the "startDeadline" of Addendum
    // A section 5.1) stays valid before it can be expired.
    public static final long SESSION_START_TIMEOUT_SECONDS = 15 * 60;

    // RecordMeterReading plausibility (rate-cap) tolerance, expressed as a
    // fraction numerator/denominator to keep the check integer-only:
    // (cumulativeWh - prevCumulativeWh) / elapsedHours <= ratedPowerKw * 1000 * tolerance.
    public static final long RATE_TOLERANCE_NUMERATOR = 11;
    public static final long RATE_TOLERANCE_DENOMINATOR = 10;

    // How long after a session SETTLES a malfunction may still be flagged.
    public static final long MALFUNCTION_WINDOW_SECONDS = 24 * 60 * 60;

    // Faucet/mint authority identity (MVP simplification, see SmartContract).
    public static final String ADMIN_IDENTITY = "minteradmin";
}
