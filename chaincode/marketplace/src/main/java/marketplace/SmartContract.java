/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.hyperledger.fabric.contract.Context;
import org.hyperledger.fabric.contract.ContractInterface;
import org.hyperledger.fabric.contract.annotation.Contact;
import org.hyperledger.fabric.contract.annotation.Contract;
import org.hyperledger.fabric.contract.annotation.Default;
import org.hyperledger.fabric.contract.annotation.Info;
import org.hyperledger.fabric.contract.annotation.License;
import org.hyperledger.fabric.contract.annotation.Transaction;
import org.hyperledger.fabric.shim.ChaincodeException;
import org.hyperledger.fabric.shim.ledger.KeyValue;
import org.hyperledger.fabric.shim.ledger.QueryResultsIterator;

/** EV charging marketplace chaincode: users, generalized providers, slots, reservation state machine, sessions, escrow. */
@Contract(
        name = "marketplace",
        info = @Info(
                title = "EV Charging Marketplace",
                description = "Decentralized marketplace for community-owned EV charging infrastructure",
                version = "1.0",
                license = @License(name = "Apache 2.0 License", url = "http://www.apache.org/licenses/LICENSE-2.0.html"),
                contact = @Contact(email = "dev@example.com", name = "EV Marketplace")))
@Default
public final class SmartContract implements ContractInterface {

    // ==================== Users ====================

    /** Registers the calling identity as a marketplace user. */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public User RegisterUser(final Context ctx, final String name) {
        String userId = ChaincodeUtil.getCallerID(ctx);
        String key = ChaincodeUtil.userKey(ctx, userId);

        String existing = ctx.getStub().getStringState(key);
        if (existing != null && !existing.isEmpty()) {
            throw new ChaincodeException("user " + userId + " is already registered");
        }

        User user = new User();
        user.setDocType(Constants.DOC_TYPE_USER);
        user.setUserId(userId);
        user.setName(name);
        user.setRegistered(true);
        ChaincodeUtil.putJSON(ctx, key, user);
        return user;
    }

    /** Returns a registered user's record. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public User GetUser(final Context ctx, final String userId) {
        String key = ChaincodeUtil.userKey(ctx, userId);
        try {
            return ChaincodeUtil.getJSON(ctx, key, User.class);
        } catch (ChaincodeException e) {
            throw new ChaincodeException("user " + userId + " not found");
        }
    }

    // ==================== Providers ====================

    /** Creates a new ChargingProvider (Commercial or Residential) along with its N slot records. */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String RegisterProvider(final Context ctx, final String providerJSON) {
        String ownerId = ChaincodeUtil.getCallerID(ctx);
        ProviderInput input = ChaincodeUtil.fromJSON(providerJSON, ProviderInput.class);

        String providerType = input.getProviderType();
        if (!Constants.PROVIDER_TYPE_COMMERCIAL.equals(providerType) && !Constants.PROVIDER_TYPE_RESIDENTIAL.equals(providerType)) {
            throw new ChaincodeException("invalid providerType " + providerType + ": must be Commercial or Residential");
        }
        if (input.getNumberOfSlots() <= 0) {
            throw new ChaincodeException("numberOfSlots must be positive");
        }
        if (input.getPricePerkWh() < 0) {
            throw new ChaincodeException("pricePerkWh must not be negative");
        }

        String providerId = "provider-" + ctx.getStub().getTxId();

        ChargingProvider provider = new ChargingProvider();
        provider.setDocType(Constants.DOC_TYPE_PROVIDER);
        provider.setProviderId(providerId);
        provider.setOwnerId(ownerId);
        provider.setProviderType(providerType);
        provider.setLatitude(input.getLatitude());
        provider.setLongitude(input.getLongitude());
        provider.setLocationLabel(input.getLocationLabel());
        provider.setPricePerkWh(input.getPricePerkWh());
        provider.setAvailableEnergy(input.getAvailableEnergy());
        provider.setNumberOfSlots(input.getNumberOfSlots());
        provider.setCurrentAvailableSlots(input.getNumberOfSlots());
        provider.setConnectorTypes(input.getConnectorTypes());
        provider.setApprovalRequired(input.isApprovalRequired());
        provider.setStatus(Constants.PROVIDER_STATUS_ACTIVE);
        provider.setIpfsHash(input.getIpfsHash());

        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.providerKey(ctx, providerId), provider);

        for (int i = 0; i < input.getNumberOfSlots(); i++) {
            String slotId = Integer.toString(i);
            Slot slot = new Slot();
            slot.setDocType(Constants.DOC_TYPE_SLOT);
            slot.setSlotId(slotId);
            slot.setProviderId(providerId);
            slot.setOccupied(false);
            slot.setCurrentReservationId("");
            ChaincodeUtil.putJSON(ctx, ChaincodeUtil.slotKey(ctx, providerId, slotId), slot);
        }

        return providerId;
    }

    /** Returns a provider's record. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public ChargingProvider GetProvider(final Context ctx, final String providerId) {
        try {
            return ChaincodeUtil.getJSON(ctx, ChaincodeUtil.providerKey(ctx, providerId), ChargingProvider.class);
        } catch (ChaincodeException e) {
            throw new ChaincodeException("provider " + providerId + " not found");
        }
    }

    /** Lets the owner activate/deactivate their provider. */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void UpdateProviderStatus(final Context ctx, final String providerId, final String status) {
        if (!Constants.PROVIDER_STATUS_ACTIVE.equals(status) && !Constants.PROVIDER_STATUS_INACTIVE.equals(status)) {
            throw new ChaincodeException("invalid status " + status + ": must be Active or Inactive");
        }
        String callerId = ChaincodeUtil.getCallerID(ctx);
        String key = ChaincodeUtil.providerKey(ctx, providerId);
        ChargingProvider provider = GetProvider(ctx, providerId);

        if (!provider.getOwnerId().equals(callerId)) {
            throw new ChaincodeException("only the provider owner may update its status");
        }
        if (Constants.PROVIDER_STATUS_DELETED.equals(provider.getStatus())) {
            throw new ChaincodeException("provider " + providerId + " has been deleted");
        }
        provider.setStatus(status);
        ChaincodeUtil.putJSON(ctx, key, provider);
    }

    /** Permanently deletes a provider (soft-delete via terminal status), owner-only, blocked while any reservation is open. */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void DeleteProvider(final Context ctx, final String providerId) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        String key = ChaincodeUtil.providerKey(ctx, providerId);
        ChargingProvider provider = GetProvider(ctx, providerId);

        if (!provider.getOwnerId().equals(callerId)) {
            throw new ChaincodeException("only the provider owner may delete this provider");
        }
        if (Constants.PROVIDER_STATUS_DELETED.equals(provider.getStatus())) {
            throw new ChaincodeException("provider " + providerId + " is already deleted");
        }
        if (hasOpenReservations(ctx, providerId)) {
            throw new ChaincodeException(
                    "provider " + providerId + " has active or pending reservations and cannot be deleted");
        }

        provider.setStatus(Constants.PROVIDER_STATUS_DELETED);
        ChaincodeUtil.putJSON(ctx, key, provider);
    }

    /**
     * Returns all slots for a provider. `occupied` is a derived display flag
     * (TRIP_RESERVATION_ADDENDUM.md section 3.2): it reflects whether a
     * booking key exists for the bucket containing `now`, not whether any
     * reservation exists for the slot, so a future booking doesn't show a
     * slot as occupied today.
     */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String GetSlots(final Context ctx, final String providerId) {
        long bucketStart = ChaincodeUtil.floorToBucket(ChaincodeUtil.txNow(ctx));
        List<Slot> slots = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getStateByPartialCompositeKey("slot", providerId)) {
            for (KeyValue result : results) {
                Slot slot = ChaincodeUtil.fromJSON(result.getStringValue(), Slot.class);
                slot.setOccupied(isBucketClaimed(ctx, providerId, slot.getSlotId(), bucketStart));
                slots.add(slot);
            }
        }
        return ChaincodeUtil.toJSON(slots);
    }

    /**
     * Read-only. Returns the occupied booking-bucket starts for
     * (providerId, slotIndex) in [fromTs, toTs) (TRIP_RESERVATION_ADDENDUM.md
     * section 4). GetStateByRange is phantom-read safe in Fabric, unlike a
     * rich-query selector over the same data would be (section 3.1).
     */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String GetSlotAvailability(final Context ctx, final String providerId, final String slotIndex, final String fromTs, final String toTs) {
        getSlotOrThrow(ctx, providerId, slotIndex);
        long from;
        long to;
        try {
            from = Long.parseLong(fromTs);
            to = Long.parseLong(toTs);
        } catch (NumberFormatException e) {
            throw new ChaincodeException("fromTs and toTs must be integer unix-second timestamps");
        }
        if (to <= from) {
            throw new ChaincodeException("toTs must be greater than fromTs");
        }

        // Inclusive of the bucket containing (to - 1), matching bucketsInWindow's
        // own [floorToBucket(windowStart), floorToBucket(windowEnd - 1)] rule --
        // a raw getStateByRange with an exclusive end key at floorToBucket(to)
        // returns nothing whenever the whole window fits inside one bucket
        // (a false negative for a bucket that IS booked), and scanning via
        // getStateByPartialCompositeKey avoids driving a raw composite-key
        // range into the peer at all, like GetSlots already does above.
        long fromBucket = ChaincodeUtil.floorToBucket(from);
        long toBucket = ChaincodeUtil.floorToBucket(to - 1);

        List<Long> occupiedBuckets = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getStateByPartialCompositeKey("booking", providerId, slotIndex)) {
            for (KeyValue result : results) {
                List<String> parts = ctx.getStub().splitCompositeKey(result.getKey()).getAttributes();
                long bucketStart = Long.parseLong(parts.get(2));
                if (bucketStart >= fromBucket && bucketStart <= toBucket) {
                    occupiedBuckets.add(bucketStart);
                }
            }
        }
        return ChaincodeUtil.toJSON(occupiedBuckets);
    }

    /**
     * Runs a CouchDB rich (Mango) query over provider records. selectorJSON is
     * either a full query object ({@code {"selector": {...}}}) or a bare
     * selector object — callers (typically the gateway) build this from type /
     * price-range / bounding-box filters. A docType filter is always enforced
     * server-side so only provider documents are returned.
     */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    @SuppressWarnings("unchecked")
    public String QueryProviders(final Context ctx, final String selectorJSON) {
        Map<String, Object> raw = (selectorJSON == null || selectorJSON.isEmpty())
                ? new HashMap<>()
                : ChaincodeUtil.fromJSON(selectorJSON, Map.class);

        Map<String, Object> selector;
        Object nested = raw.get("selector");
        if (nested instanceof Map) {
            selector = (Map<String, Object>) nested;
        } else {
            selector = raw;
        }
        selector.put("docType", Constants.DOC_TYPE_PROVIDER);

        Map<String, Object> query = new HashMap<>();
        query.put("selector", selector);

        List<ChargingProvider> providers = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getQueryResult(ChaincodeUtil.toJSON(query))) {
            for (KeyValue result : results) {
                providers.add(ChaincodeUtil.fromJSON(result.getStringValue(), ChargingProvider.class));
            }
        } catch (RuntimeException e) {
            throw new ChaincodeException("failed to execute rich query: " + e.getMessage());
        }
        return ChaincodeUtil.toJSON(providers);
    }

    // ==================== Chargers ====================

    private Charger getChargerOrThrow(final Context ctx, final String chargerId) {
        try {
            return ChaincodeUtil.getJSON(ctx, ChaincodeUtil.chargerKey(ctx, chargerId), Charger.class);
        } catch (ChaincodeException e) {
            throw new ChaincodeException("charger " + chargerId + " not found");
        }
    }

    /** Finds the Active charger bound to a given provider/slotIndex pair, or throws. */
    @SuppressWarnings("unchecked")
    private Charger getChargerBoundToSlot(final Context ctx, final String providerId, final int slotIndex) {
        Map<String, Object> selector = new HashMap<>();
        selector.put("docType", Constants.DOC_TYPE_CHARGER);
        selector.put("providerId", providerId);
        selector.put("slotIndex", slotIndex);
        selector.put("status", Constants.CHARGER_STATUS_ACTIVE);
        Map<String, Object> query = new HashMap<>();
        query.put("selector", selector);

        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getQueryResult(ChaincodeUtil.toJSON(query))) {
            for (KeyValue result : results) {
                return ChaincodeUtil.fromJSON(result.getStringValue(), Charger.class);
            }
        } catch (RuntimeException e) {
            throw new ChaincodeException("failed to execute rich query: " + e.getMessage());
        }
        throw new ChaincodeException("no charger is registered for provider " + providerId + " slot " + slotIndex);
    }

    /**
     * Binds a pre-enrolled charger identity to one (providerId, slotIndex)
     * pair. Caller must be the owner of providerId (Addendum A, section
     * 3.1). chargerJSON.chargerId must name a pre-enrolled identity -- that
     * same certificate CommonName is what later charger-only calls are
     * checked against via GetClientIdentity().
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String RegisterCharger(final Context ctx, final String chargerJSON) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        ChargerInput input = ChaincodeUtil.fromJSON(chargerJSON, ChargerInput.class);

        if (input.getChargerId() == null || input.getChargerId().isEmpty()) {
            throw new ChaincodeException("chargerId is required");
        }
        if (input.getRatedPowerKw() <= 0) {
            throw new ChaincodeException("ratedPowerKw must be positive");
        }

        ChargingProvider provider = GetProvider(ctx, input.getProviderId());
        if (!provider.getOwnerId().equals(callerId)) {
            throw new ChaincodeException("only the provider owner may register a charger for this provider");
        }
        if (input.getSlotIndex() < 0 || input.getSlotIndex() >= provider.getNumberOfSlots()) {
            throw new ChaincodeException("slotIndex " + input.getSlotIndex() + " is out of range for provider " + input.getProviderId());
        }

        boolean slotTaken = true;
        try {
            getChargerBoundToSlot(ctx, input.getProviderId(), input.getSlotIndex());
        } catch (ChaincodeException e) {
            slotTaken = false;
        }
        if (slotTaken) {
            throw new ChaincodeException("provider " + input.getProviderId() + " slot " + input.getSlotIndex() + " already has an active charger");
        }

        Charger charger = new Charger();
        charger.setDocType(Constants.DOC_TYPE_CHARGER);
        charger.setChargerId(input.getChargerId());
        charger.setProviderId(input.getProviderId());
        charger.setSlotIndex(input.getSlotIndex());
        charger.setRatedPowerKw(input.getRatedPowerKw());
        charger.setStatus(Constants.CHARGER_STATUS_ACTIVE);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.chargerKey(ctx, input.getChargerId()), charger);

        return input.getChargerId();
    }

    /** Returns a charger's record. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public Charger GetCharger(final Context ctx, final String chargerId) {
        return getChargerOrThrow(ctx, chargerId);
    }

    /** Lists all chargers registered to a given provider, for the owner's charger-management view. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String QueryChargersByProvider(final Context ctx, final String providerId) {
        Map<String, Object> selector = new HashMap<>();
        selector.put("docType", Constants.DOC_TYPE_CHARGER);
        selector.put("providerId", providerId);
        Map<String, Object> query = new HashMap<>();
        query.put("selector", selector);

        List<Charger> chargers = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getQueryResult(ChaincodeUtil.toJSON(query))) {
            for (KeyValue result : results) {
                chargers.add(ChaincodeUtil.fromJSON(result.getStringValue(), Charger.class));
            }
        } catch (RuntimeException e) {
            throw new ChaincodeException("failed to execute rich query: " + e.getMessage());
        }
        return ChaincodeUtil.toJSON(chargers);
    }

    // ==================== Reservations ====================

    /** Reads and merges a reservation's public record and private trajectory (section 7.2) into the full view. */
    private Reservation getReservationOrThrow(final Context ctx, final String reservationId) {
        ReservationPublic pub;
        try {
            pub = ChaincodeUtil.getJSON(ctx, ChaincodeUtil.reservationKey(ctx, reservationId), ReservationPublic.class);
        } catch (ChaincodeException e) {
            throw new ChaincodeException("reservation " + reservationId + " not found");
        }
        ReservationTrajectory traj = ChaincodeUtil.getPrivateJSON(
                ctx, Constants.TRAJECTORY_COLLECTION, ChaincodeUtil.reservationKey(ctx, reservationId), ReservationTrajectory.class);
        return mergeReservation(pub, traj);
    }

    private Reservation mergeReservation(final ReservationPublic pub, final ReservationTrajectory traj) {
        Reservation r = new Reservation();
        r.setDocType(Constants.DOC_TYPE_RESERVATION);
        r.setReservationId(pub.getReservationId());
        r.setDriverId(pub.getDriverId());
        r.setRequestedEnergy(pub.getRequestedEnergy());
        r.setEscrowAmount(pub.getEscrowAmount());
        r.setState(pub.getState());
        r.setCreatedAt(pub.getCreatedAt());
        r.setProviderId(traj.getProviderId());
        r.setSlotId(traj.getSlotId());
        r.setWindowStart(traj.getWindowStart());
        r.setWindowEnd(traj.getWindowEnd());
        r.setExpiresAt(traj.getExpiresAt());
        return r;
    }

    /**
     * Splits a fully-populated Reservation view and writes its two halves
     * (section 7.2): the public record to world state, the trajectory
     * (providerId, slotId, windowStart, windowEnd, expiresAt) to the private
     * collection. Every reservation write goes through this -- there is no
     * path that writes the trajectory-revealing fields to public state.
     */
    private void putReservation(final Context ctx, final Reservation reservation) {
        String key = ChaincodeUtil.reservationKey(ctx, reservation.getReservationId());

        ReservationPublic pub = new ReservationPublic();
        pub.setDocType(Constants.DOC_TYPE_RESERVATION);
        pub.setReservationId(reservation.getReservationId());
        pub.setDriverId(reservation.getDriverId());
        pub.setRequestedEnergy(reservation.getRequestedEnergy());
        pub.setEscrowAmount(reservation.getEscrowAmount());
        pub.setState(reservation.getState());
        pub.setCreatedAt(reservation.getCreatedAt());
        ChaincodeUtil.putJSON(ctx, key, pub);

        ReservationTrajectory traj = new ReservationTrajectory();
        traj.setDocType(Constants.DOC_TYPE_RESERVATION_TRAJECTORY);
        traj.setReservationId(reservation.getReservationId());
        traj.setProviderId(reservation.getProviderId());
        traj.setSlotId(reservation.getSlotId());
        traj.setWindowStart(reservation.getWindowStart());
        traj.setWindowEnd(reservation.getWindowEnd());
        traj.setExpiresAt(reservation.getExpiresAt());
        ChaincodeUtil.putPrivateJSON(ctx, Constants.TRAJECTORY_COLLECTION, key, traj);
    }

    private Slot getSlotOrThrow(final Context ctx, final String providerId, final String slotId) {
        try {
            return ChaincodeUtil.getJSON(ctx, ChaincodeUtil.slotKey(ctx, providerId, slotId), Slot.class);
        } catch (ChaincodeException e) {
            throw new ChaincodeException("slot " + slotId + " for provider " + providerId + " not found");
        }
    }

    /**
     * True if a booking key is present for the given (providerId, slotId,
     * bucketStart) triple (TRIP_RESERVATION_ADDENDUM.md section 3.1). This
     * read participates in the transaction's read set, so a concurrent
     * transaction over the same bucket is caught by Fabric's MVCC at commit
     * time exactly like the old Slot-key check.
     */
    private boolean isBucketClaimed(final Context ctx, final String providerId, final String slotId, final long bucketStart) {
        String v = ctx.getStub().getStringState(ChaincodeUtil.bookingKey(ctx, providerId, slotId, bucketStart));
        return v != null && !v.isEmpty();
    }

    /** Claims a single booking bucket, or throws if another reservation already holds it. */
    private void claimBucket(final Context ctx, final String providerId, final String slotId, final long bucketStart) {
        if (isBucketClaimed(ctx, providerId, slotId, bucketStart)) {
            throw new ChaincodeException("slot " + slotId + " on provider " + providerId + " is already booked for that time");
        }
        ctx.getStub().putStringState(ChaincodeUtil.bookingKey(ctx, providerId, slotId, bucketStart), "1");
    }

    /** Frees a single booking bucket, e.g. on cancel, expiry, or session completion. */
    private void freeBucket(final Context ctx, final String providerId, final String slotId, final long bucketStart) {
        ctx.getStub().delState(ChaincodeUtil.bookingKey(ctx, providerId, slotId, bucketStart));
    }

    /**
     * TRIP_RESERVATION_ADDENDUM.md section 3.4, integer arithmetic only.
     * windowEnd is always derived here, never accepted from a client -- a
     * client-supplied windowEnd would let a driver block a competitor's
     * charger for the price of one reservation.
     */
    private long deriveWindowEnd(final long windowStart, final long requestedEnergyWh, final int ratedPowerKw) {
        long chargeSeconds = requestedEnergyWh * 3600L / ((long) ratedPowerKw * 1000L);
        return windowStart + chargeSeconds + Constants.WINDOW_BUFFER_SECONDS;
    }

    /**
     * Enumerates the booking buckets a [windowStart, windowEnd) window
     * spans (section 3.4), rejecting windows wider than MAX_BUCKETS_PER_LEG
     * to bound the write set (and MVCC conflict surface) of a single leg.
     */
    private List<Long> bucketsInWindow(final long windowStart, final long windowEnd) {
        long firstBucket = ChaincodeUtil.floorToBucket(windowStart);
        long lastBucket = ChaincodeUtil.floorToBucket(windowEnd - 1);
        long bucketCount = (lastBucket - firstBucket) / Constants.BOOKING_BUCKET_SECONDS + 1;
        if (bucketCount > Constants.MAX_BUCKETS_PER_LEG) {
            throw new ChaincodeException(
                    "requested window spans " + bucketCount + " buckets, exceeding the " + Constants.MAX_BUCKETS_PER_LEG + "-bucket limit");
        }
        List<Long> buckets = new ArrayList<>();
        for (long bucketStart = firstBucket; bucketStart <= lastBucket; bucketStart += Constants.BOOKING_BUCKET_SECONDS) {
            buckets.add(bucketStart);
        }
        return buckets;
    }

    /**
     * Reserves a free slot for the calling driver. Escrow is locked
     * immediately if the provider does not require owner approval; otherwise
     * the reservation waits in REQUESTED state. Either way this call derives
     * a charge window starting at `now` (TRIP_RESERVATION_ADDENDUM.md
     * section 3.4) and claims every booking bucket it spans, so a losing
     * concurrent CreateReservation over any shared bucket fails cleanly
     * instead of double booking (Fabric's MVCC read-set on the booking key
     * invalidates the loser's transaction at commit time).
     *
     * providerId and slotId arrive as transient data (field "leg", a JSON
     * object {providerId, slotId}), not as regular arguments -- section 7.3:
     * they identify where the driver will be, so they must never land in the
     * block in cleartext. requestedEnergy is public and stays a regular
     * argument.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String CreateReservation(final Context ctx, final int requestedEnergy) {
        if (requestedEnergy <= 0) {
            throw new ChaincodeException("requestedEnergy must be positive");
        }
        CreateReservationInput leg = ChaincodeUtil.fromJSON(
                new String(ChaincodeUtil.getTransientOrThrow(ctx, "leg"), StandardCharsets.UTF_8), CreateReservationInput.class);
        String providerId = leg.getProviderId();
        String slotId = leg.getSlotId();
        if (providerId == null || providerId.isEmpty() || slotId == null || slotId.isEmpty()) {
            throw new ChaincodeException("transient field 'leg' must include providerId and slotId");
        }
        String driverId = ChaincodeUtil.getCallerID(ctx);

        ChargingProvider provider = GetProvider(ctx, providerId);
        if (!Constants.PROVIDER_STATUS_ACTIVE.equals(provider.getStatus())) {
            throw new ChaincodeException("provider " + providerId + " is not active");
        }

        Slot slot = getSlotOrThrow(ctx, providerId, slotId);
        Charger charger = getChargerBoundToSlot(ctx, providerId, Integer.parseInt(slotId));

        long now = ChaincodeUtil.txNow(ctx);
        long windowStart = now;
        long requestedEnergyWh = (long) requestedEnergy * 1000L;
        long windowEnd = deriveWindowEnd(windowStart, requestedEnergyWh, charger.getRatedPowerKw());
        List<Long> buckets = bucketsInWindow(windowStart, windowEnd);
        for (long bucketStart : buckets) {
            claimBucket(ctx, providerId, slotId, bucketStart);
        }

        long escrowAmount = (long) requestedEnergy * provider.getPricePerkWh();
        // check whether the buyer has enough money to set to escrow
        if (TokenLedger.getBalance(ctx, driverId) < escrowAmount) {
            throw new  ChaincodeException("You have insufficient balance to make a reservation");
        }
        String reservationId = "res-" + ctx.getStub().getTxId();

        String state = Constants.RESERVATION_STATE_CONFIRMED;
        if (provider.isApprovalRequired()) {
            state = Constants.RESERVATION_STATE_REQUESTED;
        } else {
            try {
                TokenLedger.debitBalance(ctx, driverId, escrowAmount);
            } catch (ChaincodeException e) {
                throw new ChaincodeException("cannot lock escrow: " + e.getMessage());
            }
        }

        Reservation reservation = new Reservation();
        reservation.setDocType(Constants.DOC_TYPE_RESERVATION);
        reservation.setReservationId(reservationId);
        reservation.setProviderId(providerId);
        reservation.setSlotId(slotId);
        reservation.setDriverId(driverId);
        reservation.setRequestedEnergy(requestedEnergy);
        reservation.setEscrowAmount(state.equals(Constants.RESERVATION_STATE_CONFIRMED) ? escrowAmount : 0);
        reservation.setState(state);
        reservation.setCreatedAt(now);
        reservation.setWindowStart(windowStart);
        reservation.setWindowEnd(windowEnd);
        // REQUESTED keeps the existing owner-approval timeout; CONFIRMED's
        // start deadline is now anchored to the charge window, not creation
        // time (section 9) -- for a walk-up reservation windowStart == now,
        // so this is numerically identical to the old 15-minute-from-creation deadline.
        reservation.setExpiresAt(Constants.RESERVATION_STATE_CONFIRMED.equals(state)
                ? windowStart + Constants.WINDOW_GRACE_SECONDS
                : now + Constants.RESERVATION_TIMEOUT_SECONDS);
        putReservation(ctx, reservation);

        // occupied is now a derived display flag (GetSlots); exclusivity for
        // this bucket was already established above by claimBucket.
        slot.setCurrentReservationId(reservationId);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.slotKey(ctx, providerId, slotId), slot);

        provider.setCurrentAvailableSlots(provider.getCurrentAvailableSlots() - 1);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.providerKey(ctx, providerId), provider);

        return reservationId;
    }

    /** Lets a residential provider's owner approve a pending (REQUESTED) reservation, locking escrow and moving it to CONFIRMED. */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void ApproveReservation(final Context ctx, final String reservationId) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        Reservation reservation = getReservationOrThrow(ctx, reservationId);
        ChargingProvider provider = GetProvider(ctx, reservation.getProviderId());

        if (!provider.getOwnerId().equals(callerId)) {
            throw new ChaincodeException("only the provider owner may approve this reservation");
        }
        if (!Constants.RESERVATION_STATE_REQUESTED.equals(reservation.getState())) {
            throw new ChaincodeException("reservation " + reservationId + " is not awaiting approval (state=" + reservation.getState() + ")");
        }

        long now = ChaincodeUtil.txNow(ctx);
        if (now > reservation.getExpiresAt()) {
            expireReservation(ctx, reservation);
            throw new ChaincodeException("reservation " + reservationId + " expired before approval");
        }

        long escrowAmount = reservation.getRequestedEnergy() * provider.getPricePerkWh();
        try {
            TokenLedger.debitBalance(ctx, reservation.getDriverId(), escrowAmount);
        } catch (ChaincodeException e) {
            throw new ChaincodeException("cannot lock escrow: " + e.getMessage());
        }

        reservation.setState(Constants.RESERVATION_STATE_CONFIRMED);
        reservation.setEscrowAmount(escrowAmount);
        // Anchored to the already-claimed charge window (section 9), not to
        // approval time -- the buckets held since creation were claimed for
        // windowStart, not for whenever the owner happens to approve.
        reservation.setExpiresAt(reservation.getWindowStart() + Constants.WINDOW_GRACE_SECONDS);
        putReservation(ctx, reservation);
    }

    /** Cancels a REQUESTED or CONFIRMED reservation, refunding any locked escrow and freeing the slot. */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void CancelReservation(final Context ctx, final String reservationId) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        Reservation reservation = getReservationOrThrow(ctx, reservationId);
        ChargingProvider provider = GetProvider(ctx, reservation.getProviderId());

        if (!reservation.getDriverId().equals(callerId) && !provider.getOwnerId().equals(callerId)) {
            throw new ChaincodeException("only the driver or provider owner may cancel this reservation");
        }
        String state = reservation.getState();
        if (!Constants.RESERVATION_STATE_REQUESTED.equals(state) && !Constants.RESERVATION_STATE_CONFIRMED.equals(state)) {
            throw new ChaincodeException("reservation " + reservationId + " cannot be cancelled from state " + state);
        }

        if (reservation.getEscrowAmount() > 0) {
            TokenLedger.creditBalance(ctx, reservation.getDriverId(), reservation.getEscrowAmount());
            reservation.setEscrowAmount(0);
        }

        reservation.setState(Constants.RESERVATION_STATE_CANCELLED);
        putReservation(ctx, reservation);
        freeSlot(ctx, reservation);
    }

    /**
     * Books an entire itinerary atomically (TRIP_RESERVATION_ADDENDUM.md
     * section 4). All legs are validated before anything is written; any
     * failure throws, which discards the whole write set, so there is never
     * a half-booked trip. Excludes approval-required providers (section 5,
     * fork 1a) -- the "whole trip is booked" guarantee isn't achievable when
     * a leg would enter REQUESTED and wait on a human. Errors are
     * pipe-delimited (`CODE|legIndex|providerId|message`, legIndex/providerId
     * empty for whole-trip failures) so the gateway can identify and re-plan
     * around the offending leg.
     *
     * requestedEnergyWhJSON (a JSON array of Wh amounts, public per section
     * 7.2) is a regular argument. providerId/slotIndex/windowStart per leg
     * arrive as transient data (field "legs", a JSON array of
     * {providerId, slotIndex, windowStart}, index-aligned with the public
     * array) -- section 7.3, same rationale as CreateReservation.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String ReserveTripLegs(final Context ctx, final String requestedEnergyWhJSON) {
        long[] requestedEnergyWhList = ChaincodeUtil.fromJSON(requestedEnergyWhJSON, long[].class);
        TripLegPrivateInput[] privateLegs = ChaincodeUtil.fromJSON(
                new String(ChaincodeUtil.getTransientOrThrow(ctx, "legs"), StandardCharsets.UTF_8), TripLegPrivateInput[].class);
        if (requestedEnergyWhList == null || privateLegs == null || requestedEnergyWhList.length != privateLegs.length) {
            throw new ChaincodeException("TRIP_INVALID_LEG_COUNT|-1||public and private leg arrays must be the same, non-zero length");
        }
        TripLegInput[] legs = new TripLegInput[privateLegs.length];
        for (int i = 0; i < legs.length; i++) {
            TripLegInput leg = new TripLegInput();
            leg.setProviderId(privateLegs[i].getProviderId());
            leg.setSlotIndex(privateLegs[i].getSlotIndex());
            leg.setWindowStart(privateLegs[i].getWindowStart());
            leg.setRequestedEnergyWh(requestedEnergyWhList[i]);
            legs[i] = leg;
        }
        if (legs.length < 1 || legs.length > Constants.MAX_TRIP_LEGS) {
            throw new ChaincodeException("TRIP_INVALID_LEG_COUNT|-1||must submit between 1 and " + Constants.MAX_TRIP_LEGS + " legs");
        }

        String driverId = ChaincodeUtil.getCallerID(ctx);
        long now = ChaincodeUtil.txNow(ctx);

        if (legs[0].getWindowStart() < now - Constants.CLOCK_SKEW_TOLERANCE_SECONDS) {
            throw new ChaincodeException("TRIP_LEG_WINDOW_PAST|0|" + legs[0].getProviderId() + "|windowStart is before the allowed clock-skew tolerance");
        }
        int lastLeg = legs.length - 1;
        if (legs[lastLeg].getWindowStart() > now + Constants.MAX_ADVANCE_BOOKING_SECONDS) {
            throw new ChaincodeException("TRIP_LEG_WINDOW_TOO_FAR|" + lastLeg + "|" + legs[lastLeg].getProviderId()
                    + "|windowStart exceeds the " + Constants.MAX_ADVANCE_BOOKING_SECONDS + "s advance-booking limit");
        }

        // Pass 1 (validation steps 3, 6, 7, 8): resolve each leg's provider
        // and charger, derive its window, and check strictly-increasing
        // ordering against the previous leg -- all before any bucket or
        // balance check, so a shape/eligibility error is reported first.
        ChargingProvider[] providers = new ChargingProvider[legs.length];
        long[] windowEnds = new long[legs.length];
        List<List<Long>> bucketsPerLeg = new ArrayList<>();
        long previousWindowEnd = Long.MIN_VALUE;

        for (int i = 0; i < legs.length; i++) {
            TripLegInput leg = legs[i];
            if (i > 0 && leg.getWindowStart() < previousWindowEnd) {
                throw new ChaincodeException("TRIP_LEG_WINDOW_ORDER|" + i + "|" + leg.getProviderId()
                        + "|windowStart must be at or after the previous leg's derived windowEnd (" + previousWindowEnd + ")");
            }

            ChargingProvider provider;
            try {
                provider = GetProvider(ctx, leg.getProviderId());
            } catch (ChaincodeException e) {
                throw new ChaincodeException("TRIP_LEG_PROVIDER_UNAVAILABLE|" + i + "|" + leg.getProviderId() + "|provider not found");
            }
            if (!Constants.PROVIDER_STATUS_ACTIVE.equals(provider.getStatus())) {
                throw new ChaincodeException("TRIP_LEG_PROVIDER_UNAVAILABLE|" + i + "|" + leg.getProviderId() + "|provider is not active");
            }
            if (provider.isApprovalRequired()) {
                throw new ChaincodeException("TRIP_LEG_APPROVAL_REQUIRED|" + i + "|" + leg.getProviderId() + "|provider requires manual approval");
            }

            Charger charger;
            try {
                charger = getChargerBoundToSlot(ctx, leg.getProviderId(), leg.getSlotIndex());
            } catch (ChaincodeException e) {
                throw new ChaincodeException("TRIP_LEG_NO_CHARGER|" + i + "|" + leg.getProviderId() + "|no charger registered on slot " + leg.getSlotIndex());
            }

            long windowEnd = deriveWindowEnd(leg.getWindowStart(), leg.getRequestedEnergyWh(), charger.getRatedPowerKw());
            List<Long> buckets;
            try {
                buckets = bucketsInWindow(leg.getWindowStart(), windowEnd);
            } catch (ChaincodeException e) {
                throw new ChaincodeException("TRIP_LEG_WINDOW_TOO_LONG|" + i + "|" + leg.getProviderId() + "|" + e.getMessage());
            }

            providers[i] = provider;
            windowEnds[i] = windowEnd;
            bucketsPerLeg.add(buckets);
            previousWindowEnd = windowEnd;
        }

        // Pass 2 (validation step 9): every bucket must still be free. A
        // separate pass so all windows are known-valid before any conflict
        // is reported, and so no bucket is claimed until every leg clears.
        for (int i = 0; i < legs.length; i++) {
            TripLegInput leg = legs[i];
            String slotId = Integer.toString(leg.getSlotIndex());
            for (long bucketStart : bucketsPerLeg.get(i)) {
                if (isBucketClaimed(ctx, leg.getProviderId(), slotId, bucketStart)) {
                    throw new ChaincodeException("TRIP_LEG_CONFLICT|" + i + "|" + leg.getProviderId() + "|slot booked at bucket start " + bucketStart);
                }
            }
        }

        // Validation step 10: one combined balance check for the whole trip.
        long totalCost = 0;
        for (int i = 0; i < legs.length; i++) {
            totalCost += legs[i].getRequestedEnergyWh() * providers[i].getPricePerkWh() / 1000;
        }
        long balance = TokenLedger.getBalance(ctx, driverId);
        if (totalCost > balance) {
            throw new ChaincodeException("TRIP_INSUFFICIENT_BALANCE|-1||need " + totalCost + ", have " + balance);
        }

        // Step 11: write everything. Every leg above has already been
        // validated, so nothing here can fail for a business reason; only
        // the single balance debit happens once, for the summed cost.
        List<String> reservationIds = new ArrayList<>();
        for (int i = 0; i < legs.length; i++) {
            TripLegInput leg = legs[i];
            String slotId = Integer.toString(leg.getSlotIndex());
            for (long bucketStart : bucketsPerLeg.get(i)) {
                claimBucket(ctx, leg.getProviderId(), slotId, bucketStart);
            }

            long legCost = legs[i].getRequestedEnergyWh() * providers[i].getPricePerkWh() / 1000;
            String reservationId = "res-" + ctx.getStub().getTxId() + "-" + i;

            Reservation reservation = new Reservation();
            reservation.setDocType(Constants.DOC_TYPE_RESERVATION);
            reservation.setReservationId(reservationId);
            reservation.setProviderId(leg.getProviderId());
            reservation.setSlotId(slotId);
            reservation.setDriverId(driverId);
            reservation.setRequestedEnergy(leg.getRequestedEnergyWh() / 1000);
            reservation.setEscrowAmount(legCost);
            reservation.setState(Constants.RESERVATION_STATE_CONFIRMED);
            reservation.setCreatedAt(now);
            reservation.setWindowStart(leg.getWindowStart());
            reservation.setWindowEnd(windowEnds[i]);
            reservation.setExpiresAt(leg.getWindowStart() + Constants.WINDOW_GRACE_SECONDS);
            putReservation(ctx, reservation);

            Slot slot = getSlotOrThrow(ctx, leg.getProviderId(), slotId);
            slot.setCurrentReservationId(reservationId);
            ChaincodeUtil.putJSON(ctx, ChaincodeUtil.slotKey(ctx, leg.getProviderId(), slotId), slot);

            ChargingProvider provider = providers[i];
            provider.setCurrentAvailableSlots(provider.getCurrentAvailableSlots() - 1);
            ChaincodeUtil.putJSON(ctx, ChaincodeUtil.providerKey(ctx, leg.getProviderId()), provider);

            reservationIds.add(reservationId);
        }

        TokenLedger.debitBalance(ctx, driverId, totalCost);

        return ChaincodeUtil.toJSON(reservationIds);
    }

    /**
     * Cancels a set of reservations in one transaction, refunding all
     * locked escrow and freeing all their buckets. Driver or provider owner
     * only, checked per reservation. Any single failure aborts the whole
     * batch (Fabric's all-or-nothing transaction semantics), so a partial
     * trip cancellation never happens.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String CancelTripLegs(final Context ctx, final String reservationIdsJSON) {
        String[] reservationIds = ChaincodeUtil.fromJSON(reservationIdsJSON, String[].class);
        if (reservationIds == null || reservationIds.length == 0) {
            throw new ChaincodeException("reservationIds must be a non-empty array");
        }
        String callerId = ChaincodeUtil.getCallerID(ctx);

        long totalRefunded = 0;
        for (String reservationId : reservationIds) {
            Reservation reservation = getReservationOrThrow(ctx, reservationId);
            ChargingProvider provider = GetProvider(ctx, reservation.getProviderId());
            if (!reservation.getDriverId().equals(callerId) && !provider.getOwnerId().equals(callerId)) {
                throw new ChaincodeException("only the driver or provider owner may cancel reservation " + reservationId);
            }
            String state = reservation.getState();
            if (!Constants.RESERVATION_STATE_REQUESTED.equals(state) && !Constants.RESERVATION_STATE_CONFIRMED.equals(state)) {
                throw new ChaincodeException("reservation " + reservationId + " cannot be cancelled from state " + state);
            }

            if (reservation.getEscrowAmount() > 0) {
                TokenLedger.creditBalance(ctx, reservation.getDriverId(), reservation.getEscrowAmount());
                totalRefunded += reservation.getEscrowAmount();
                reservation.setEscrowAmount(0);
            }
            reservation.setState(Constants.RESERVATION_STATE_CANCELLED);
            putReservation(ctx, reservation);
            freeSlot(ctx, reservation);
        }

        return ChaincodeUtil.toJSON(totalRefunded);
    }

    /**
     * Transitions a REQUESTED or CONFIRMED reservation past its expiresAt
     * into EXPIRED, refunding any locked escrow (REQUESTED has none;
     * CONFIRMED does) and freeing the slot. Anyone may call this; it errors
     * if the reservation isn't actually expired.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void ExpireReservation(final Context ctx, final String reservationId) {
        Reservation reservation = getReservationOrThrow(ctx, reservationId);
        String state = reservation.getState();
        if (!Constants.RESERVATION_STATE_REQUESTED.equals(state) && !Constants.RESERVATION_STATE_CONFIRMED.equals(state)) {
            throw new ChaincodeException("reservation " + reservationId + " is not in REQUESTED or CONFIRMED state");
        }
        long now = ChaincodeUtil.txNow(ctx);
        if (now <= reservation.getExpiresAt()) {
            throw new ChaincodeException("reservation " + reservationId + " has not yet expired");
        }

        expireReservation(ctx, reservation);
    }

    /** Refunds any locked escrow, marks the reservation EXPIRED, and frees its slot. */
    private void expireReservation(final Context ctx, final Reservation reservation) {
        if (reservation.getEscrowAmount() > 0) {
            TokenLedger.creditBalance(ctx, reservation.getDriverId(), reservation.getEscrowAmount());
            reservation.setEscrowAmount(0);
        }
        reservation.setState(Constants.RESERVATION_STATE_EXPIRED);
        putReservation(ctx, reservation);
        freeSlot(ctx, reservation);
    }

    /** Returns a reservation's record. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public Reservation GetReservation(final Context ctx, final String reservationId) {
        return getReservationOrThrow(ctx, reservationId);
    }

    /** Lists all reservations made by a given driver, most useful for the driver's own reservation/session status view. driverId is public, so this queries public state directly. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String QueryReservationsByDriver(final Context ctx, final String driverId) {
        Map<String, Object> selector = new HashMap<>();
        selector.put("driverId", driverId);
        return ChaincodeUtil.toJSON(mergeReservations(ctx, queryPublicReservations(ctx, selector)));
    }

    /**
     * Lists all reservations against a given provider, for a provider
     * owner's pending-approvals view. providerId is private (section 7.2),
     * so -- unlike the other Query* methods here -- this queries the
     * trajectoryCollection's own rich-query index first, then fetches each
     * hit's public record to complete the view.
     */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String QueryReservationsByProvider(final Context ctx, final String providerId) {
        Map<String, Object> selector = new HashMap<>();
        selector.put("providerId", providerId);
        return ChaincodeUtil.toJSON(mergeReservationsFromTrajectories(ctx, queryTrajectories(ctx, selector)));
    }

    /** Lists all reservations in a given state, used by an external process to sweep for timed-out reservations. state is public, so this queries public state directly. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String QueryReservationsByState(final Context ctx, final String state) {
        Map<String, Object> selector = new HashMap<>();
        selector.put("state", state);
        return ChaincodeUtil.toJSON(mergeReservations(ctx, queryPublicReservations(ctx, selector)));
    }

    private List<ReservationPublic> queryPublicReservations(final Context ctx, final Map<String, Object> selector) {
        selector.put("docType", Constants.DOC_TYPE_RESERVATION);
        Map<String, Object> query = new HashMap<>();
        query.put("selector", selector);

        List<ReservationPublic> reservations = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getQueryResult(ChaincodeUtil.toJSON(query))) {
            for (KeyValue result : results) {
                reservations.add(ChaincodeUtil.fromJSON(result.getStringValue(), ReservationPublic.class));
            }
        } catch (RuntimeException e) {
            throw new ChaincodeException("failed to execute rich query: " + e.getMessage());
        }
        return reservations;
    }

    private List<ReservationTrajectory> queryTrajectories(final Context ctx, final Map<String, Object> selector) {
        selector.put("docType", Constants.DOC_TYPE_RESERVATION_TRAJECTORY);
        Map<String, Object> query = new HashMap<>();
        query.put("selector", selector);

        List<ReservationTrajectory> trajectories = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getPrivateDataQueryResult(Constants.TRAJECTORY_COLLECTION, ChaincodeUtil.toJSON(query))) {
            for (KeyValue result : results) {
                trajectories.add(ChaincodeUtil.fromJSON(result.getStringValue(), ReservationTrajectory.class));
            }
        } catch (RuntimeException e) {
            throw new ChaincodeException("failed to execute private rich query: " + e.getMessage());
        }
        return trajectories;
    }

    private List<Reservation> mergeReservations(final Context ctx, final List<ReservationPublic> publics) {
        List<Reservation> merged = new ArrayList<>();
        for (ReservationPublic pub : publics) {
            ReservationTrajectory traj = ChaincodeUtil.getPrivateJSON(
                    ctx, Constants.TRAJECTORY_COLLECTION, ChaincodeUtil.reservationKey(ctx, pub.getReservationId()), ReservationTrajectory.class);
            merged.add(mergeReservation(pub, traj));
        }
        return merged;
    }

    private List<Reservation> mergeReservationsFromTrajectories(final Context ctx, final List<ReservationTrajectory> trajectories) {
        List<Reservation> merged = new ArrayList<>();
        for (ReservationTrajectory traj : trajectories) {
            ReservationPublic pub = ChaincodeUtil.getJSON(ctx, ChaincodeUtil.reservationKey(ctx, traj.getReservationId()), ReservationPublic.class);
            merged.add(mergeReservation(pub, traj));
        }
        return merged;
    }

    /** True if a provider has any reservation in a non-terminal state (REQUESTED/CONFIRMED/ACTIVE). providerId is private, so this queries the trajectoryCollection, then checks each hit's public state. */
    private boolean hasOpenReservations(final Context ctx, final String providerId) {
        Map<String, Object> selector = new HashMap<>();
        selector.put("providerId", providerId);
        for (ReservationTrajectory traj : queryTrajectories(ctx, selector)) {
            ReservationPublic pub = ChaincodeUtil.getJSON(ctx, ChaincodeUtil.reservationKey(ctx, traj.getReservationId()), ReservationPublic.class);
            if (Constants.RESERVATION_STATE_REQUESTED.equals(pub.getState())
                    || Constants.RESERVATION_STATE_CONFIRMED.equals(pub.getState())
                    || Constants.RESERVATION_STATE_ACTIVE.equals(pub.getState())) {
                return true;
            }
        }
        return false;
    }

    /**
     * Clears a slot's current-reservation pointer, bumps the provider's
     * available-slot counter back up, and frees every booking bucket in
     * [windowStart, windowEnd) the given reservation claimed (section 9:
     * cancel/expire must free all of a reservation's buckets, not just one).
     */
    private void freeSlot(final Context ctx, final Reservation reservation) {
        String providerId = reservation.getProviderId();
        String slotId = reservation.getSlotId();

        Slot slot = getSlotOrThrow(ctx, providerId, slotId);
        slot.setCurrentReservationId("");
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.slotKey(ctx, providerId, slotId), slot);

        ChargingProvider provider = GetProvider(ctx, providerId);
        provider.setCurrentAvailableSlots(provider.getCurrentAvailableSlots() + 1);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.providerKey(ctx, providerId), provider);

        for (long bucketStart : bucketsInWindow(reservation.getWindowStart(), reservation.getWindowEnd())) {
            freeBucket(ctx, providerId, slotId, bucketStart);
        }
    }

    // ==================== Sessions ====================

    private Session getSessionOrThrow(final Context ctx, final String sessionId) {
        try {
            return ChaincodeUtil.getJSON(ctx, ChaincodeUtil.sessionKey(ctx, sessionId), Session.class);
        } catch (ChaincodeException e) {
            throw new ChaincodeException("session " + sessionId + " not found");
        }
    }

    /**
     * Begins charging against a CONFIRMED reservation, moving the
     * reservation to ACTIVE and creating its Session record. Amended by
     * Addendum A section 3.2: charger-only. Caller must be the charger
     * identity bound to the reservation's slot -- not merely a charger --
     * and physical plug-in (this call) is what starts the session, closing
     * the phantom-session fraud vector by construction.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String StartSession(final Context ctx, final String reservationId) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        Reservation reservation = getReservationOrThrow(ctx, reservationId);
        if (!Constants.RESERVATION_STATE_CONFIRMED.equals(reservation.getState())) {
            throw new ChaincodeException("reservation " + reservationId + " is not CONFIRMED (state=" + reservation.getState() + ")");
        }

        long now = ChaincodeUtil.txNow(ctx);
        if (now < reservation.getWindowStart() - Constants.CLOCK_SKEW_TOLERANCE_SECONDS) {
            throw new ChaincodeException("reservation " + reservationId + " cannot start before its window (starts at "
                    + reservation.getWindowStart() + ")");
        }
        if (now > reservation.getExpiresAt()) {
            expireReservation(ctx, reservation);
            throw new ChaincodeException("reservation " + reservationId + " expired before the session was started");
        }

        int slotIndex = Integer.parseInt(reservation.getSlotId());
        Charger charger = getChargerBoundToSlot(ctx, reservation.getProviderId(), slotIndex);
        if (!callerId.equals(charger.getChargerId())) {
            throw new ChaincodeException("only the charger bound to this slot may start the session");
        }

        String sessionId = "sess-" + ctx.getStub().getTxId();

        Session session = new Session();
        session.setDocType(Constants.DOC_TYPE_SESSION);
        session.setSessionId(sessionId);
        session.setReservationId(reservationId);
        session.setChargerId(charger.getChargerId());
        session.setStartTime(now);
        session.setEndTime(0);
        session.setCumulativeWh(0);
        session.setReadingCount(0);
        session.setLastReadingTimestamp(now);
        session.setState(Constants.SESSION_STATE_ACTIVE);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.sessionKey(ctx, sessionId), session);

        reservation.setState(Constants.RESERVATION_STATE_ACTIVE);
        putReservation(ctx, reservation);

        return sessionId;
    }

    /**
     * Appends a signed, monotonically-increasing cumulative meter reading
     * from the bound charger (Addendum A, section 3.3). All five validation
     * rules are enforced; any failure rejects the transaction. On success,
     * writes an immutable Reading record and updates the session's
     * denormalized cumulativeWh/readingCount -- only the bound charger ever
     * writes a given session's record during ACTIVE, so there is no
     * cross-client MVCC contention on it.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void RecordMeterReading(final Context ctx, final String sessionId, final long cumulativeWh) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        Session session = getSessionOrThrow(ctx, sessionId);
        if (!Constants.SESSION_STATE_ACTIVE.equals(session.getState())) {
            throw new ChaincodeException("session " + sessionId + " is not Active (state=" + session.getState() + ")");
        }

        Charger charger = getChargerOrThrow(ctx, session.getChargerId());
        if (!callerId.equals(charger.getChargerId())) {
            throw new ChaincodeException("only the charger bound to this session may record readings");
        }

        long prevCumulativeWh = session.getCumulativeWh();
        if (cumulativeWh < prevCumulativeWh) {
            throw new ChaincodeException("cumulativeWh must not decrease (previous=" + prevCumulativeWh + ", got=" + cumulativeWh + ")");
        }

        long now = ChaincodeUtil.txNow(ctx);
        long deltaWh = cumulativeWh - prevCumulativeWh;
        long elapsedSeconds = now - session.getLastReadingTimestamp();
        if (deltaWh > 0) {
            if (elapsedSeconds <= 0) {
                throw new ChaincodeException("reading rejected: no elapsed time since the previous reading");
            }
            // deltaWh/elapsedHours <= ratedPowerKw*1000*tolerance, rearranged to avoid
            // floats/division: deltaWh*3600*DENOM <= ratedPowerKw*1000*NUMER*elapsedSeconds
            long lhs = deltaWh * 3600L * Constants.RATE_TOLERANCE_DENOMINATOR;
            long rhs = (long) charger.getRatedPowerKw() * 1000L * Constants.RATE_TOLERANCE_NUMERATOR * elapsedSeconds;
            if (lhs > rhs) {
                throw new ChaincodeException("reading rejected: implies power above the charger's rated capacity");
            }
        }

        Reservation reservation = getReservationOrThrow(ctx, session.getReservationId());
        ChargingProvider provider = GetProvider(ctx, reservation.getProviderId());
        long impliedCost = cumulativeWh * provider.getPricePerkWh() / 1000;
        if (impliedCost > reservation.getEscrowAmount()) {
            throw new ChaincodeException("reading rejected: implied cost would exceed the reservation's locked hold");
        }

        int seq = session.getReadingCount() + 1;
        Reading reading = new Reading();
        reading.setDocType(Constants.DOC_TYPE_READING);
        reading.setSessionId(sessionId);
        reading.setSeq(seq);
        reading.setCumulativeWh(cumulativeWh);
        reading.setTimestamp(now);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.readingKey(ctx, sessionId, seq), reading);

        session.setCumulativeWh(cumulativeWh);
        session.setReadingCount(seq);
        session.setLastReadingTimestamp(now);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.sessionKey(ctx, sessionId), session);
    }

    /** Returns all readings for a session, in ascending seq order (the composite-key range is already so ordered). */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String GetSessionReadings(final Context ctx, final String sessionId) {
        List<Reading> readings = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getStateByPartialCompositeKey("reading", sessionId)) {
            for (KeyValue result : results) {
                readings.add(ChaincodeUtil.fromJSON(result.getStringValue(), Reading.class));
            }
        }
        return ChaincodeUtil.toJSON(readings);
    }

    /**
     * Settles and closes an ACTIVE session (Addendum A, section 3.4).
     * Callable by either the driver or the bound charger. Settlement is
     * computed entirely from the session's last recorded cumulative
     * reading -- no party supplies a number. The RecordMeterReading hold-cap
     * rule (3.3.5) should make the min() a no-op; it is kept as a defensive
     * invariant.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void StopSession(final Context ctx, final String sessionId) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        Session session = getSessionOrThrow(ctx, sessionId);
        if (!Constants.SESSION_STATE_ACTIVE.equals(session.getState())) {
            throw new ChaincodeException("session " + sessionId + " is not Active (state=" + session.getState() + ")");
        }

        Reservation reservation = getReservationOrThrow(ctx, session.getReservationId());
        ChargingProvider provider = GetProvider(ctx, reservation.getProviderId());
        Charger charger = getChargerOrThrow(ctx, session.getChargerId());
        if (!callerId.equals(reservation.getDriverId()) && !callerId.equals(charger.getChargerId())) {
            throw new ChaincodeException("only the driver or the bound charger may stop this session");
        }

        long cost = session.getCumulativeWh() * provider.getPricePerkWh() / 1000;
        long paid = Math.min(cost, reservation.getEscrowAmount());
        long refund = reservation.getEscrowAmount() - paid;

        if (paid > 0) {
            TokenLedger.creditBalance(ctx, provider.getOwnerId(), paid);
        }
        if (refund > 0) {
            TokenLedger.creditBalance(ctx, reservation.getDriverId(), refund);
        }
        reservation.setEscrowAmount(0);

        long now = ChaincodeUtil.txNow(ctx);
        long actualKwhDelivered = session.getCumulativeWh() / 1000;
        session.setDeliveredEnergy(actualKwhDelivered);
        session.setSettledAmount(paid);
        session.setEndTime(now);
        session.setState(Constants.SESSION_STATE_SETTLED);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.sessionKey(ctx, sessionId), session);

        reservation.setState(Constants.RESERVATION_STATE_COMPLETED);
        putReservation(ctx, reservation);

        // Reconcile: availableEnergy was decremented by requestedEnergy at
        // confirmation; add back the unused portion now that actual
        // delivery is known.
        provider.setAvailableEnergy(provider.getAvailableEnergy() + reservation.getRequestedEnergy() - actualKwhDelivered);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.providerKey(ctx, provider.getProviderId()), provider);

        freeSlot(ctx, reservation);
    }

    /** Returns a session's record. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public Session GetSession(final Context ctx, final String sessionId) {
        return getSessionOrThrow(ctx, sessionId);
    }

    /** Returns the (at most one) session for a given reservation. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String QuerySessionsByReservation(final Context ctx, final String reservationId) {
        Map<String, Object> selector = new HashMap<>();
        selector.put("docType", Constants.DOC_TYPE_SESSION);
        selector.put("reservationId", reservationId);
        Map<String, Object> query = new HashMap<>();
        query.put("selector", selector);

        List<Session> sessions = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getQueryResult(ChaincodeUtil.toJSON(query))) {
            for (KeyValue result : results) {
                sessions.add(ChaincodeUtil.fromJSON(result.getStringValue(), Session.class));
            }
        } catch (RuntimeException e) {
            throw new ChaincodeException("failed to execute rich query: " + e.getMessage());
        }
        return ChaincodeUtil.toJSON(sessions);
    }

    /**
     * Vestigial malfunction acknowledgement (Addendum A, section 3.5),
     * replacing DisputeSession. Callable by the driver or provider owner on
     * a SETTLED session within a short fixed window. Does not freeze,
     * reverse, or re-open settlement -- under the stated trust assumption
     * there is nothing on-ledger to adjudicate; this exists only so the
     * malfunction case is acknowledged rather than silently impossible.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void FlagChargerMalfunction(final Context ctx, final String sessionId, final String note) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        Session session = getSessionOrThrow(ctx, sessionId);
        if (!Constants.SESSION_STATE_SETTLED.equals(session.getState())) {
            throw new ChaincodeException("session " + sessionId + " cannot be flagged from state " + session.getState());
        }

        Reservation reservation = getReservationOrThrow(ctx, session.getReservationId());
        ChargingProvider provider = GetProvider(ctx, reservation.getProviderId());
        if (!callerId.equals(reservation.getDriverId()) && !callerId.equals(provider.getOwnerId())) {
            throw new ChaincodeException("only the driver or provider owner may flag this session");
        }

        long now = ChaincodeUtil.txNow(ctx);
        if (now - session.getEndTime() > Constants.MALFUNCTION_WINDOW_SECONDS) {
            throw new ChaincodeException("the malfunction-flag window for session " + sessionId + " has closed");
        }

        MalfunctionFlag flag = new MalfunctionFlag();
        flag.setDocType(Constants.DOC_TYPE_MALFUNCTION);
        flag.setSessionId(sessionId);
        flag.setNote(note);
        flag.setFlaggedBy(callerId);
        flag.setFlaggedAt(now);
        ChaincodeUtil.putJSON(ctx, ChaincodeUtil.malfunctionKey(ctx, sessionId), flag);
    }

    // ==================== Admin ====================

    /**
     * Deletes all providers, slots, reservations, sessions, and booking/
     * trajectory data from world state and the trajectoryCollection.
     * Dev-only reset utility, admin-only; leaves users and token balances
     * untouched. This is also the documented, intended way to cross the R5
     * public/private boundary on a dev network -- no migration is needed
     * because there is nothing to migrate through a reset.
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void ResetMarketplaceData(final Context ctx) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        if (!callerId.equals(Constants.ADMIN_IDENTITY)) {
            throw new ChaincodeException("only " + Constants.ADMIN_IDENTITY + " may reset marketplace data");
        }
        deleteAllOfType(ctx, "provider");
        deleteAllOfType(ctx, "slot");
        deleteAllOfType(ctx, "reservation");
        deleteAllOfType(ctx, "session");
        deleteAllOfType(ctx, "charger");
        deleteAllOfType(ctx, "reading");
        deleteAllOfType(ctx, "malfunction");
        deleteAllOfType(ctx, "booking");
        deleteAllPrivateOfType(ctx, Constants.TRAJECTORY_COLLECTION, "reservation");
    }

    private void deleteAllOfType(final Context ctx, final String objectType) {
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getStateByPartialCompositeKey(objectType)) {
            for (KeyValue result : results) {
                ctx.getStub().delState(result.getKey());
            }
        }
    }

    private void deleteAllPrivateOfType(final Context ctx, final String collection, final String objectType) {
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getPrivateDataByPartialCompositeKey(collection, objectType)) {
            for (KeyValue result : results) {
                ctx.getStub().delPrivateData(collection, result.getKey());
            }
        }
    }

    // ==================== Token ====================

    /** Credits amount to userId. Dev-only faucet, admin-only. */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void Mint(final Context ctx, final String userId, final int amount) {
        String callerId = ChaincodeUtil.getCallerID(ctx);
        if (!callerId.equals(Constants.ADMIN_IDENTITY)) {
            throw new ChaincodeException("only " + Constants.ADMIN_IDENTITY + " may mint tokens");
        }
        if (amount <= 0) {
            throw new ChaincodeException("mint amount must be positive");
        }
        TokenLedger.creditBalance(ctx, userId, amount);
    }

    /** Returns a user's token balance. */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public long GetBalance(final Context ctx, final String userId) {
        return TokenLedger.getBalance(ctx, userId);
    }

    /** Moves amount from the caller's balance to `to`. Optional in the MVP scope, included for completeness. */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void Transfer(final Context ctx, final String to, final int amount) {
        if (amount <= 0) {
            throw new ChaincodeException("transfer amount must be positive");
        }
        String callerId = ChaincodeUtil.getCallerID(ctx);
        if (callerId.equals(to)) {
            throw new ChaincodeException("cannot transfer to self");
        }
        TokenLedger.debitBalance(ctx, callerId, amount);
        TokenLedger.creditBalance(ctx, to, amount);
    }
}
