-- Read-only regression: same-host overlapping invitations must not remain available.
WITH candidate(host, slot) AS (
 VALUES ('host-a', '2026-11-03T14:00:00Z'::timestamptz)
), bookings(host, slot) AS (
 VALUES ('host-a', '2026-11-03T14:00:00Z'::timestamptz),
        ('host-a', '2026-11-03T14:15:00Z'::timestamptz),
        ('host-a', '2026-11-03T14:30:00Z'::timestamptz),
        ('host-b', '2026-11-03T14:00:00Z'::timestamptz)
), results AS (
 SELECT b.host,b.slot,(b.host=c.host AND b.slot<c.slot+interval '30 minutes'
   AND b.slot+interval '30 minutes'>c.slot) AS conflicts
 FROM candidate c CROSS JOIN bookings b
)
SELECT count(*) FILTER (WHERE conflicts)=2 AS same_host_overlaps_blocked,
 count(*) FILTER (WHERE NOT conflicts)=2 AS adjacent_and_other_hosts_allowed,
 (SELECT pg_get_functiondef('public.get_demo_available_slots(text)'::regprocedure)
   LIKE '%other.assigned_to=d.assigned_to%') AS live_cross_invitation_guard,
 (SELECT pg_get_functiondef('public.confirm_demo_slot_by_token(text,timestamptz)'::regprocedure)
   LIKE '%pg_advisory_xact_lock%') AS live_host_lock
FROM results;