/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/**
 * An append-only, immutable meter reading submitted by the bound charger
 * during an active session (Addendum A, section 3.3). Never mutated; the
 * session's denormalized cumulativeWh/readingCount are the fast-path read,
 * this is the audit trail.
 */
@DataType()
public class Reading {

    @Property() private String docType;
    @Property() private String sessionId;
    @Property() private int seq;
    @Property() private long cumulativeWh;
    @Property() private long timestamp;

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

    public int getSeq() {
        return seq;
    }

    public void setSeq(final int seq) {
        this.seq = seq;
    }

    public long getCumulativeWh() {
        return cumulativeWh;
    }

    public void setCumulativeWh(final long cumulativeWh) {
        this.cumulativeWh = cumulativeWh;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(final long timestamp) {
        this.timestamp = timestamp;
    }
}
