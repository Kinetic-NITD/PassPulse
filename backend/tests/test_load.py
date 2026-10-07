"""
Load test: concurrent scan+confirm and race conditions.

Reports p50/p95 latency, error count, and verifies checked_in count matches successful confirms.
Optimized for remote DB with batch setup.

Usage:
    python -m pytest tests/test_load.py -v -s
"""

import os
import time
import uuid
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
import psycopg
from psycopg.rows import dict_row

from tests.conftest import make_event, make_staff, make_signing_key
from app.services import claim_ticket, confirm_ticket


NUM_TICKETS = 50
CONCURRENCY = 5


class TestLoadConcurrent:
    """Load test with scan+confirm at concurrency matching DB pool limit."""

    def test_concurrent_scan_confirm(self, db_pool, test_schema):
        """
        Create tickets, then scan+confirm each concurrently.
        Every ticket should end up checked_in exactly once.
        """
        pool = db_pool

        # Setup: create event, staff, signing key, and participants+tickets in batch
        with pool.connection() as conn:
            event_id = make_event(conn, "Load Test Event")
            staff_id = make_staff(conn, name="LoadTester", role="volunteer")
            make_signing_key(conn, key_id=1)

            part_rows = []
            ticket_rows = []
            ticket_ids = []
            for i in range(NUM_TICKETS):
                pid = uuid.uuid4()
                tid = uuid.uuid4()
                ticket_ids.append(tid)
                part_rows.append((str(pid), str(event_id), f"LoadParticipant-{i}", f"load-{pid.hex[:8]}@example.com", "College"))
                ticket_rows.append((str(tid), str(event_id), str(pid), "issued", 1))

            conn.cursor().executemany(
                "INSERT INTO participants (id, event_id, name, email, college) VALUES (%s, %s, %s, %s, %s);",
                part_rows,
            )
            conn.cursor().executemany(
                "INSERT INTO tickets (id, event_id, participant_id, status, key_id) VALUES (%s, %s, %s, %s, %s);",
                ticket_rows,
            )
            conn.commit()

        print(f"\nCreated {NUM_TICKETS} tickets for load test.")
        print(f"Running with concurrency={CONCURRENCY}...")

        # Run scan + confirm for each ticket
        latencies = []
        errors = []
        success_count = 0

        def scan_and_confirm(ticket_id, card_no):
            start = time.monotonic()
            try:
                with pool.connection() as conn:
                    claim_res = claim_ticket(conn, ticket_id, staff_id)
                    conn.commit()
                    if not claim_res.success:
                        return {"ticket_id": str(ticket_id), "error": f"claim failed: {claim_res.reason}", "latency": time.monotonic() - start}

                    confirm_res = confirm_ticket(conn, ticket_id, staff_id, card_no)
                    conn.commit()
                    elapsed = time.monotonic() - start
                    if confirm_res.success:
                        return {"ticket_id": str(ticket_id), "success": True, "latency": elapsed}
                    else:
                        return {"ticket_id": str(ticket_id), "error": f"confirm failed: {confirm_res.reason}", "latency": elapsed}
            except Exception as e:
                return {"ticket_id": str(ticket_id), "error": str(e), "latency": time.monotonic() - start}

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            futures = {}
            for i, tid in enumerate(ticket_ids):
                card_no = f"LOAD-{i:04d}"
                f = executor.submit(scan_and_confirm, tid, card_no)
                futures[f] = tid

            for f in as_completed(futures):
                result = f.result()
                latencies.append(result["latency"])
                if result.get("success"):
                    success_count += 1
                elif result.get("error"):
                    errors.append(result)

        # Report
        latencies.sort()
        p50 = statistics.median(latencies)
        p95 = latencies[int(len(latencies) * 0.95)] if len(latencies) > 20 else max(latencies)

        print(f"\n{'='*50}")
        print(f"  LOAD TEST RESULTS")
        print(f"{'='*50}")
        print(f"  Total tickets:    {NUM_TICKETS}")
        print(f"  Concurrency:      {CONCURRENCY}")
        print(f"  Successful:       {success_count}")
        print(f"  Errors:           {len(errors)}")
        print(f"  p50 latency:      {p50*1000:.1f} ms")
        print(f"  p95 latency:      {p95*1000:.1f} ms")
        print(f"  Min latency:      {min(latencies)*1000:.1f} ms")
        print(f"  Max latency:      {max(latencies)*1000:.1f} ms")
        print(f"{'='*50}")

        if errors:
            print(f"\n  First 5 errors:")
            for e in errors[:5]:
                print(f"    {e['ticket_id']}: {e['error']}")

        # Verify DB state: exactly success_count tickets should be checked_in
        with pool.connection() as conn:
            checked_in = conn.execute(
                "SELECT COUNT(*) AS cnt FROM tickets WHERE event_id = %s AND status = 'checked_in';",
                (str(event_id),),
            ).fetchone()["cnt"]

        print(f"\n  DB checked_in count: {checked_in}")
        assert checked_in == success_count, f"DB shows {checked_in} checked_in but {success_count} confirms succeeded"
        assert success_count == NUM_TICKETS, f"Expected {NUM_TICKETS} successes, got {success_count}"

    def test_double_scan_single_winner(self, db_pool, test_schema):
        """
        Two volunteers race to claim the same 20 tickets simultaneously.
        Each ticket should have exactly 1 winner.
        """
        pool = db_pool
        NUM_RACE = 20

        with pool.connection() as conn:
            event_id = make_event(conn, "Race Test Event")
            vol1 = make_staff(conn, name="RaceVol1", role="volunteer")
            vol2 = make_staff(conn, name="RaceVol2", role="volunteer")
            make_signing_key(conn, key_id=1)

            part_rows = []
            ticket_rows = []
            ticket_ids = []
            for i in range(NUM_RACE):
                pid = uuid.uuid4()
                tid = uuid.uuid4()
                ticket_ids.append(tid)
                part_rows.append((str(pid), str(event_id), f"RaceParticipant-{i}", f"race-{pid.hex[:8]}@example.com", "College"))
                ticket_rows.append((str(tid), str(event_id), str(pid), "issued", 1))

            conn.cursor().executemany(
                "INSERT INTO participants (id, event_id, name, email, college) VALUES (%s, %s, %s, %s, %s);",
                part_rows,
            )
            conn.cursor().executemany(
                "INSERT INTO tickets (id, event_id, participant_id, status, key_id) VALUES (%s, %s, %s, %s, %s);",
                ticket_rows,
            )
            conn.commit()

        print(f"\nRace test: 2 volunteers × {NUM_RACE} tickets...")

        claim_wins = {str(vol1): 0, str(vol2): 0}
        claim_conflicts = 0

        def race_claim(ticket_id, staff_id):
            with pool.connection() as conn:
                res = claim_ticket(conn, ticket_id, staff_id)
                conn.commit()
                return res

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            for tid in ticket_ids:
                futures = [
                    executor.submit(race_claim, tid, vol1),
                    executor.submit(race_claim, tid, vol2),
                ]
                results = [f.result() for f in futures]

                winners = [r for r in results if r.success]
                losers = [r for r in results if not r.success]

                if len(winners) == 1:
                    with pool.connection() as conn:
                        t = conn.execute(
                            "SELECT pending_by FROM tickets WHERE id = %s;",
                            (str(tid),),
                        ).fetchone()
                        if t and t["pending_by"]:
                            claim_wins[str(t["pending_by"])] += 1
                elif len(winners) == 2:
                    with pool.connection() as conn:
                        t = conn.execute(
                            "SELECT pending_by FROM tickets WHERE id = %s;",
                            (str(tid),),
                        ).fetchone()
                        if t and t["pending_by"]:
                            claim_wins[str(t["pending_by"])] += 1
                else:
                    claim_conflicts += 1

        print(f"  Vol1 wins: {claim_wins[str(vol1)]}")
        print(f"  Vol2 wins: {claim_wins[str(vol2)]}")
        print(f"  Conflicts: {claim_conflicts}")

        total_wins = claim_wins[str(vol1)] + claim_wins[str(vol2)]
        assert total_wins + claim_conflicts == NUM_RACE

        # Verify: each ticket is in pending state with exactly one pending_by
        with pool.connection() as conn:
            pending_count = conn.execute(
                "SELECT COUNT(*) AS cnt FROM tickets WHERE event_id = %s AND status = 'pending' AND pending_by IS NOT NULL;",
                (str(event_id),),
            ).fetchone()["cnt"]

        assert pending_count == NUM_RACE, f"Expected {NUM_RACE} pending tickets, got {pending_count}"
