/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/**
 * The trajectory-revealing half of a reservation (TRIP_RESERVATION_ADDENDUM.md
 * section 7.2), stored only in the {@code trajectoryCollection} private data
 * collection, keyed the same as the public {@link ReservationPublic} record.
 * {@code expiresAt} is included here even though section 7.2's table omits
 * it: for a CONFIRMED reservation it equals windowStart + a fixed constant,
 * so leaving it on the public record would reveal windowStart via a
 * constant offset and defeat the point of hiding it. bucketKeys is
 * deliberately not stored -- it is fully and deterministically recoverable
 * from (windowStart, windowEnd), so storing it separately would only add a
 * derive/store-mismatch risk for no benefit.
 */
@DataType()
public class ReservationTrajectory {

    @Property() private String docType;
    @Property() private String reservationId;
    @Property() private String providerId;
    @Property() private String slotId;
    @Property() private long windowStart;
    @Property() private long windowEnd;
    @Property() private long expiresAt;

    public String getDocType() {
        return docType;
    }

    public void setDocType(final String docType) {
        this.docType = docType;
    }

    public String getReservationId() {
        return reservationId;
    }

    public void setReservationId(final String reservationId) {
        this.reservationId = reservationId;
    }

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(final String providerId) {
        this.providerId = providerId;
    }

    public String getSlotId() {
        return slotId;
    }

    public void setSlotId(final String slotId) {
        this.slotId = slotId;
    }

    public long getWindowStart() {
        return windowStart;
    }

    public void setWindowStart(final long windowStart) {
        this.windowStart = windowStart;
    }

    public long getWindowEnd() {
        return windowEnd;
    }

    public void setWindowEnd(final long windowEnd) {
        this.windowEnd = windowEnd;
    }

    public long getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(final long expiresAt) {
        this.expiresAt = expiresAt;
    }
}
