"""
State machine and concurrency tests on the real DB (in isolated test schema).
"""

import concurrent.futures
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import psycopg

from app.services import (
    claim_ticket,
    confirm_ticket,
    cancel_ticket,
    revoke_ticket,
    reissue_ticket,
    supervisor_override,
)
from tests.conftest import (
    make_event,
    make_participant,
    make_staff,
    make_signing_key,
    make_ticket,
)


class TestStateMachine:

    def test_claim_confirm_flow_and_scan_log(self, test_schema, db_conn):
        eid = make_event(db_conn, "Flow Event")
        pid = make_participant(db_conn, eid, "Flow User", "flow@example.com")
        sid = make_staff(db_conn, "Volunteer 1")
        kid = make_signing_key(db_conn, key_id=10)
        tid = make_ticket(db_conn, eid, pid, key_id=10)

        # 1. Claim
        res = claim_ticket(db_conn, tid, sid, lease_seconds=60)
        db_conn.commit()
        assert res.success is True
        assert res.reason == "claimed"
        assert res.data["participant"]["name"] == "Flow User"

        # Check ticket pending
        row = db_conn.execute("SELECT * FROM tickets WHERE id=%s", (str(tid),)).fetchone()
        assert row["status"] == "pending"
        assert row["pending_by"] == sid

        # Check scan_log
        log = db_conn.execute(
            "SELECT * FROM scan_log WHERE ticket_id=%s ORDER BY id DESC LIMIT 1",
            (str(tid),),
        ).fetchone()
        assert log["action"] == "claim"
        assert log["result"] == "success"

        # 2. Confirm
        res2 = confirm_ticket(db_conn, tid, sid, id_card_no="CARD-1001")
        db_conn.commit()
        assert res2.success is True
        assert res2.reason == "checked_in"

        # Check ticket checked_in
        row = db_conn.execute("SELECT * FROM tickets WHERE id=%s", (str(tid),)).fetchone()
        assert row["status"] == "checked_in"
        assert row["id_card_no"] == "CARD-1001"
        assert row["checked_in_by"] == sid

        # Check scan_log
        log2 = db_conn.execute(
            "SELECT * FROM scan_log WHERE ticket_id=%s ORDER BY id DESC LIMIT 1",
            (str(tid),),
        ).fetchone()
        assert log2["action"] == "confirm"
        assert log2["result"] == "success"

    def test_same_volunteer_rescan_refreshes_lease(self, test_schema, db_conn):
        eid = make_event(db_conn, "Rescan Event")
        pid = make_participant(db_conn, eid)
        sid = make_staff(db_conn)
        kid = make_signing_key(db_conn, key_id=11)
        tid = make_ticket(db_conn, eid, pid, key_id=11)

        claim_ticket(db_conn, tid, sid, lease_seconds=10)
        db_conn.commit()
        t1 = db_conn.execute("SELECT pending_until FROM tickets WHERE id=%s", (str(tid),)).fetchone()["pending_until"]

        # Re-scan with larger lease
        res = claim_ticket(db_conn, tid, sid, lease_seconds=300)
        db_conn.commit()
        assert res.success is True
        t2 = db_conn.execute("SELECT pending_until FROM tickets WHERE id=%s", (str(tid),)).fetchone()["pending_until"]
        assert t2 > t1

    def test_cancel_releases_and_non_holder_fails(self, test_schema, db_conn):
        eid = make_event(db_conn, "Cancel Event")
        pid = make_participant(db_conn, eid)
        sid1 = make_staff(db_conn, "Vol 1")
        sid2 = make_staff(db_conn, "Vol 2")
        kid = make_signing_key(db_conn, key_id=12)
        tid = make_ticket(db_conn, eid, pid, key_id=12)

        # Claim by sid1
        claim_ticket(db_conn, tid, sid1, lease_seconds=60)
        db_conn.commit()

        # sid2 tries to cancel -> fails
        res_fail = cancel_ticket(db_conn, tid, sid2)
        db_conn.commit()
        assert res_fail.success is False
        assert res_fail.reason == "pending_other"

        # sid1 cancels -> succeeds
        res_ok = cancel_ticket(db_conn, tid, sid1)
        db_conn.commit()
        assert res_ok.success is True

        row = db_conn.execute("SELECT * FROM tickets WHERE id=%s", (str(tid),)).fetchone()
        assert row["status"] == "issued"
        assert row["pending_by"] is None

    def test_confirm_without_claim_fails(self, test_schema, db_conn):
        eid = make_event(db_conn, "No Claim Event")
        pid = make_participant(db_conn, eid)
        sid = make_staff(db_conn)
        kid = make_signing_key(db_conn, key_id=13)
        tid = make_ticket(db_conn, eid, pid, key_id=13)

        res = confirm_ticket(db_conn, tid, sid, id_card_no="CARD-NO-CLAIM")
        db_conn.commit()
        assert res.success is False
        assert res.reason == "not_claimed"

    def test_scan_or_confirm_on_revoked_fails(self, test_schema, db_conn):
        eid = make_event(db_conn, "Revoke Event")
        pid = make_participant(db_conn, eid)
        sid = make_staff(db_conn)
        kid = make_signing_key(db_conn, key_id=14)
        tid = make_ticket(db_conn, eid, pid, key_id=14, status="revoked")

        # Claim revoked
        res_claim = claim_ticket(db_conn, tid, sid)
        db_conn.commit()
        assert res_claim.success is False
        assert res_claim.reason == "revoked"

        # Confirm revoked
        res_conf = confirm_ticket(db_conn, tid, sid, "CARD-REV")
        db_conn.commit()
        assert res_conf.success is False
        assert res_conf.reason == "revoked"

    def test_scan_on_checked_in_returns_full_details(self, test_schema, db_conn):
        eid = make_event(db_conn, "CheckedIn Scan Event")
        pid = make_participant(db_conn, eid, name="Checked In Person")
        sid = make_staff(db_conn, name="Checker Volunteer")
        kid = make_signing_key(db_conn, key_id=15)
        tid = make_ticket(db_conn, eid, pid, key_id=15)

        claim_ticket(db_conn, tid, sid, 60)
        confirm_ticket(db_conn, tid, sid, "CARD-ALREADY")
        db_conn.commit()

        # Another scan
        res = claim_ticket(db_conn, tid, sid)
        db_conn.commit()
        assert res.success is False
        assert res.reason == "already_checked_in"
        assert res.details["name"] == "Checked In Person"
        assert res.details["id_card_no"] == "CARD-ALREADY"
        assert res.details["staff_name"] == "Checker Volunteer"
        assert res.details["checked_in_at"] is not None

    def test_duplicate_id_card_no_rejected_and_stays_pending(self, test_schema, db_conn):
        eid = make_event(db_conn, "Duplicate Card Event")
        p1 = make_participant(db_conn, eid, "P1", "p1@example.com")
        p2 = make_participant(db_conn, eid, "P2", "p2@example.com")
        sid = make_staff(db_conn)
        kid = make_signing_key(db_conn, key_id=16)

        t1 = make_ticket(db_conn, eid, p1, key_id=16)
        t2 = make_ticket(db_conn, eid, p2, key_id=16)

        # Confirm t1 with CARD-DUP
        claim_ticket(db_conn, t1, sid, 60)
        res1 = confirm_ticket(db_conn, t1, sid, "CARD-DUP")
        db_conn.commit()
        assert res1.success is True

        # Claim t2
        claim_ticket(db_conn, t2, sid, 60)
        db_conn.commit()

        # Try to confirm t2 with same card
        res2 = confirm_ticket(db_conn, t2, sid, "CARD-DUP")
        db_conn.commit()
        assert res2.success is False
        assert res2.reason == "id_card_taken"

        # Verify t2 is STILL pending
        row2 = db_conn.execute("SELECT * FROM tickets WHERE id=%s", (str(t2),)).fetchone()
        assert row2["status"] == "pending"

    def test_lease_expiry_allows_takeover(self, test_schema, db_conn):
        eid = make_event(db_conn, "Expiry Event")
        pid = make_participant(db_conn, eid)
        sid1 = make_staff(db_conn, "Vol 1")
        sid2 = make_staff(db_conn, "Vol 2")
        kid = make_signing_key(db_conn, key_id=17)
        tid = make_ticket(db_conn, eid, pid, key_id=17)

        # sid1 claims
        claim_ticket(db_conn, tid, sid1, lease_seconds=60)
        db_conn.commit()

        # Backdate pending_until to past
        db_conn.execute(
            "UPDATE tickets SET pending_until = now() - interval '10 seconds' WHERE id=%s",
            (str(tid),),
        )
        db_conn.commit()

        # sid2 can now claim!
        res_takeover = claim_ticket(db_conn, tid, sid2, lease_seconds=60)
        db_conn.commit()
        assert res_takeover.success is True

        # sid1 tries to confirm now -> fails because sid2 is now holder
        res_old_holder = confirm_ticket(db_conn, tid, sid1, "CARD-OLD")
        db_conn.commit()
        assert res_old_holder.success is False
        assert res_old_holder.reason == "pending_other"

    def test_reissue_flow(self, test_schema, db_conn):
        eid = make_event(db_conn, "Reissue Event")
        pid = make_participant(db_conn, eid)
        sid = make_staff(db_conn)
        kid = make_signing_key(db_conn, key_id=18)
        tid = make_ticket(db_conn, eid, pid, key_id=18)

        # Reissue
        res = reissue_ticket(db_conn, tid, sid, reason="Lost phone", key_id=18)
        db_conn.commit()
        assert res.success is True
        new_ticket_id = res.data["new_ticket"]["id"]
        assert new_ticket_id != str(tid)

        # Verify old ticket revoked with replaced_by set
        old_row = db_conn.execute("SELECT * FROM tickets WHERE id=%s", (str(tid),)).fetchone()
        assert old_row["status"] == "revoked"
        assert str(old_row["replaced_by"]) == str(new_ticket_id)
        assert old_row["revoked_reason"] == "Lost phone"

        # Verify new ticket is issued
        new_row = db_conn.execute("SELECT * FROM tickets WHERE id=%s", (str(new_ticket_id),)).fetchone()
        assert new_row["status"] == "issued"

        # Refuse reissue if checked_in
        claim_ticket(db_conn, new_ticket_id, sid, 60)
        confirm_ticket(db_conn, new_ticket_id, sid, "CARD-REISSUE")
        db_conn.commit()

        res_refuse = reissue_ticket(db_conn, new_ticket_id, sid, reason="Another reissue")
        db_conn.commit()
        assert res_refuse.success is False
        assert res_refuse.reason == "already_checked_in"

    def test_supervisor_override(self, test_schema, db_conn):
        eid = make_event(db_conn, "Override Event")
        pid = make_participant(db_conn, eid)
        sid = make_staff(db_conn)
        sup = make_staff(db_conn, name="Supervisor", role="supervisor")
        kid = make_signing_key(db_conn, key_id=19)
        tid = make_ticket(db_conn, eid, pid, key_id=19)

        claim_ticket(db_conn, tid, sid, 60)
        confirm_ticket(db_conn, tid, sid, "CARD-ORIG")
        db_conn.commit()

        # Reprint badge with new card
        res_reprint = supervisor_override(
            db_conn, tid, sup, action="reprint_badge", reason="Printer jammed", id_card_no="CARD-NEW"
        )
        db_conn.commit()
        assert res_reprint.success is True
        assert res_reprint.data["ticket"]["id_card_no"] == "CARD-NEW"

        # Reset check-in
        res_reset = supervisor_override(
            db_conn, tid, sup, action="reset_checkin", reason="Accidental scan"
        )
        db_conn.commit()
        assert res_reset.success is True
        assert res_reset.data["ticket"]["status"] == "issued"
        assert res_reset.data["ticket"]["id_card_no"] is None


class TestConcurrency:

    def test_concurrent_claims_single_winner(self, test_schema, db_pool):
        """Two volunteers claiming the same issued ticket concurrently: exactly 1 winner, 1 pending_other."""
        with db_pool.connection() as conn:
            eid = make_event(conn, "Concurrent Claim")
            pid = make_participant(conn, eid)
            v1 = make_staff(conn, "V1")
            v2 = make_staff(conn, "V2")
            kid = make_signing_key(conn, key_id=20)
            tid = make_ticket(conn, eid, pid, key_id=20)

        results = []

        def do_claim(volunteer_id):
            with db_pool.connection() as c:
                res = claim_ticket(c, tid, volunteer_id, lease_seconds=60)
                c.commit()
                return res

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(do_claim, v1)
            f2 = executor.submit(do_claim, v2)
            results = [f1.result(), f2.result()]

        winners = [r for r in results if r.success is True]
        losers = [r for r in results if r.success is False]

        assert len(winners) == 1, f"Expected 1 winner, got {len(winners)}"
        assert len(losers) == 1
        assert losers[0].reason == "pending_other"

    def test_50_concurrent_confirms_single_winner(self, test_schema, db_pool):
        """50 concurrent confirms on the same pending ticket give exactly 1 success and 49 already_checked_in."""
        with db_pool.connection() as conn:
            eid = make_event(conn, "50 Confirms")
            pid = make_participant(conn, eid)
            sid = make_staff(conn, "Vol Holder")
            kid = make_signing_key(conn, key_id=21)
            tid = make_ticket(conn, eid, pid, key_id=21)

            # Claim first
            claim_ticket(conn, tid, sid, lease_seconds=120)
            conn.commit()

        results = []

        def do_confirm(worker_idx):
            with db_pool.connection() as c:
                res = confirm_ticket(c, tid, sid, id_card_no=f"CARD-{worker_idx}")
                c.commit()
                return res

        # Run 50 confirms concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(do_confirm, i) for i in range(50)]
            results = [f.result() for f in futures]

        successes = [r for r in results if r.success is True]
        failures = [r for r in results if r.success is False]

        assert len(successes) == 1, f"Expected exactly 1 success, got {len(successes)}"
        assert len(failures) == 49, f"Expected 49 failures, got {len(failures)}"
        for fail in failures:
            assert fail.reason == "already_checked_in"
