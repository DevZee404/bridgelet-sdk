# Handling Overlapping Payment Monitor Ticks

## Context

The payment monitor runs on a `cron` or `setInterval` tick. If Horizon is slow, or the downstream database is locked, a tick may take longer than the interval duration, causing the next tick to overlap.

## Symptoms

- Duplicate payment processing logs.
- Database deadlock exceptions on the `payments` table.
- High memory usage on the SDK worker instance.

## Remediation Steps

1. **Verify Mutex/Locking Mechanism**
   Ensure the distributed lock (e.g. Redis `SETNX` or DB advisory lock) is functioning. The second tick should gracefully skip if the lock is held.

2. **Check Lock Expiry**
   If the first tick crashed without releasing the lock, check the lock TTL. Is it too long? Force release the lock manually via Redis/DB if it's confirmed dead.

3. **Scale the Worker**
   If a single tick consistently takes too long, investigate pagination. Ensure the monitor is only fetching small batches (e.g., 50 records) per tick rather than unbounded queries.

4. **Alert Muting**
   If this is a known transient network issue, temporarily suppress PagerDuty alerts for "Overlap Detected" until the network stabilizes.
