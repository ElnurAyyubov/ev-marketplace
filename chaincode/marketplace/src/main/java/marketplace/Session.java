/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/**
 * A single charging session tied to a confirmed reservation and bound
 * charger. Settlement is computed entirely from cumulativeWh, the last
 * value written by an on-ledger meter reading (Addendum A, section 3.3/3.4)
 * -- no party ever supplies a delivered-energy figure.
 */
@DataType()
public class Session {

    @Property() private String docType;
    @Property() private String sessionId;
    @Property() private String reservationId;
    @Property() private String chargerId;
    @Property() private long startTime;
    @Property() private long endTime;
    @Property() private long cumulativeWh;
    @Property() private int readingCount;
    @Property() private long lastReadingTimestamp;
    @Property() private long deliveredEnergy;
    @Property() private long settledAmount;
    @Property() private String state;

    public String getDocType() {
        return docType;
    }

    public void setDocType(final String docType) {
        this.docType = docType;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(final String sessionId) {
        this.sessionId = sessionId;
    }

    public String getReservationId() {
        return reservationId;
    }

    public void setReservationId(final String reservationId) {
        this.reservationId = reservationId;
    }

    public String getChargerId() {
        return chargerId;
    }

    public void setChargerId(final String chargerId) {
        this.chargerId = chargerId;
    }

    public long getStartTime() {
        return startTime;
    }

    public void setStartTime(final long startTime) {
        this.startTime = startTime;
    }

    public long getEndTime() {
        return endTime;
    }

    public void setEndTime(final long endTime) {
        this.endTime = endTime;
    }

    public long getCumulativeWh() {
        return cumulativeWh;
    }

    public void setCumulativeWh(final long cumulativeWh) {
        this.cumulativeWh = cumulativeWh;
    }

    public int getReadingCount() {
        return readingCount;
    }

    public void setReadingCount(final int readingCount) {
        this.readingCount = readingCount;
    }

    public long getLastReadingTimestamp() {
        return lastReadingTimestamp;
    }

    public void setLastReadingTimestamp(final long lastReadingTimestamp) {
        this.lastReadingTimestamp = lastReadingTimestamp;
    }

    public long getDeliveredEnergy() {
        return deliveredEnergy;
    }

    public void setDeliveredEnergy(final long deliveredEnergy) {
        this.deliveredEnergy = deliveredEnergy;
    }

    public long getSettledAmount() {
        return settledAmount;
    }

    public void setSettledAmount(final long settledAmount) {
        this.settledAmount = settledAmount;
    }

    public String getState() {
        return state;
    }

    public void setState(final String state) {
        this.state = state;
    }
}
