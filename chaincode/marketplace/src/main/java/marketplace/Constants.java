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
    public static final String DOC_TYPE_RESERVATION_TRAJECTORY = "reservationTrajectory";

    // Private data collection holding the trajectory-revealing half of a
    // reservation (providerId, slotId, windowStart, windowEnd, expiresAt) --
    // TRIP_RESERVATION_ADDENDUM.md section 7.
    public static final String TRAJECTORY_COLLECTION = "trajectoryCollection";

    // Provider types. Left open-ended (plain string) so future kinds
    // (hotel, mall, workplace, ...) can be added without a contract change.
    public static final String PROVIDER_TYPE_COMMERCIAL = "Commercial";
    public static final String PROVIDER_TYPE_RESIDENTIAL = "Residential";

    public static final String PROVIDER_STATUS_ACTIVE = "Active";
    public static final String PROVIDER_STATUS_INACTIVE = "Inactive";
    public static final String PROVIDER_STATUS_DELETED = "Deleted";

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

    // RecordMeterReading plausibility (rate-cap) tolerance, expressed as a
    // fraction numerator/denominator to keep the check integer-only:
    // (cumulativeWh - prevCumulativeWh) / elapsedHours <= ratedPowerKw * 1000 * tolerance.
    public static final long RATE_TOLERANCE_NUMERATOR = 11;
    public static final long RATE_TOLERANCE_DENOMINATOR = 10;

    // How long after a session SETTLES a malfunction may still be flagged.
    public static final long MALFUNCTION_WINDOW_SECONDS = 24 * 60 * 60;

    // Faucet/mint authority identity (MVP simplification, see SmartContract).
    public static final String ADMIN_IDENTITY = "minteradmin";

    // Trip reservation booking buckets (TRIP_RESERVATION_ADDENDUM.md section
    // 3): a slot's availability is tracked per fixed-width time bucket
    // rather than by a single occupied flag, so a booking for later doesn't
    // block a walk-up reservation today.
    public static final long BOOKING_BUCKET_SECONDS = 1800; // 30 min

    // Window derivation and bounds (TRIP_RESERVATION_ADDENDUM.md sections 3.4-3.5).
    public static final int MAX_BUCKETS_PER_LEG = 8;            // 4 h
    public static final long WINDOW_BUFFER_SECONDS = 1200;      // 20 min
    public static final long WINDOW_GRACE_SECONDS = 900;        // 15 min
    public static final long CLOCK_SKEW_TOLERANCE_SECONDS = 300; // 5 min

    // ReserveTripLegs bounds (TRIP_RESERVATION_ADDENDUM.md section 3.5).
    public static final int MAX_TRIP_LEGS = 6;
    public static final long MAX_ADVANCE_BOOKING_SECONDS = 86400; // 24 h
}
