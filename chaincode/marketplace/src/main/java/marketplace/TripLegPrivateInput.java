/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

/**
 * The private half of one {@code ReserveTripLegs} leg, submitted as
 * transient data under the {@code legs} field (a JSON array, index-aligned
 * with the public requestedEnergyWh array) -- TRIP_RESERVATION_ADDENDUM.md
 * section 7.3. providerId, slotIndex, and windowStart together identify
 * where and when a driver will be, so none of them may travel as a regular
 * argument.
 */
public class TripLegPrivateInput {

    private String providerId;
    private int slotIndex;
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

    public long getWindowStart() {
        return windowStart;
    }

    public void setWindowStart(final long windowStart) {
        this.windowStart = windowStart;
    }
}
