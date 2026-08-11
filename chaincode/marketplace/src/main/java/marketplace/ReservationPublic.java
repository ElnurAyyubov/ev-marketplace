/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/**
 * The public half of a reservation (TRIP_RESERVATION_ADDENDUM.md section
 * 7.2): everything that does not, by itself or combined with the public
 * booking-bucket keys, reveal where or when the driver will be. "This driver
 * holds a reservation" -- no place, no time. The trajectory-revealing half
 * (providerId, slotId, windowStart, windowEnd, expiresAt) lives in
 * {@link ReservationTrajectory}, in the {@code trajectoryCollection} private
 * data collection.
 */
@DataType()
public class ReservationPublic {

    @Property() private String docType;
    @Property() private String reservationId;
    @Property() private String driverId;
    @Property() private long requestedEnergy;
    @Property() private long escrowAmount;
    @Property() private String state;
    @Property() private long createdAt;

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

    public String getDriverId() {
        return driverId;
    }

    public void setDriverId(final String driverId) {
        this.driverId = driverId;
    }

    public long getRequestedEnergy() {
        return requestedEnergy;
    }

    public void setRequestedEnergy(final long requestedEnergy) {
        this.requestedEnergy = requestedEnergy;
    }

    public long getEscrowAmount() {
        return escrowAmount;
    }

    public void setEscrowAmount(final long escrowAmount) {
        this.escrowAmount = escrowAmount;
    }

    public String getState() {
        return state;
    }

    public void setState(final String state) {
        this.state = state;
    }

    public long getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(final long createdAt) {
        this.createdAt = createdAt;
    }
}
