/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

/**
 * The private half of a {@code CreateReservation} call, submitted as
 * transient data under the {@code leg} field (TRIP_RESERVATION_ADDENDUM.md
 * section 7.3) -- providerId and slotId identify where a driver will be, so
 * they must never land in the block in cleartext as a regular argument.
 * requestedEnergy stays a regular argument: it is public (section 7.2).
 */
public class CreateReservationInput {

    private String providerId;
    private String slotId;

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
}
