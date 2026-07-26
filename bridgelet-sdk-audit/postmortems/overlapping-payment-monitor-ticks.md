# Postmortem: Overlapping Payment Monitor Ticks

## Issue Summary

The `setInterval`-based polling approach for Horizon payments allowed multiple overlapping requests when the RPC latency spiked. This caused memory leaks and duplicate payment handling logic execution.

## Root Cause

`setInterval` schedules executions at fixed intervals regardless of whether the previous execution has finished. During a Horizon latency spike, ticks accumulated in the event loop.

## Resolution

Migrated the polling mechanism from `setInterval` to a recursive `setTimeout` pattern combined with a distributed advisory lock to guarantee strict sequential execution and backpressure handling.
