/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

/**
 * One leg of the JSON array accepted by {@code ReserveTripLegs}
 * (TRIP_RESERVATION_ADDENDUM.md section 4). {@code windowEnd} is
 * deliberately absent -- it is always chaincode-derived from
 * {@code requestedEnergyWh} and the bound charger's rated power, never
 * accepted from the client.
 */
public class TripLegInput {

    private String providerId;
    private int slotIndex;
    private long requestedEnergyWh;
    private long windowStart;

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(final String providerId) {
        this.providerId = providerId;
    }

    public int getSlotIndex() {
        return slotIndex;
    }

    public void setSlotIndex(final int slotIndex) {
        this.slotIndex = slotIndex;
    }

    public long getRequestedEnergyWh() {
        return requestedEnergyWh;
    }

    public void setRequestedEnergyWh(final long requestedEnergyWh) {
        this.requestedEnergyWh = requestedEnergyWh;
    }

    public long getWindowStart() {
        return windowStart;
    }

    public void setWindowStart(final long windowStart) {
        this.windowStart = windowStart;
    }
}
