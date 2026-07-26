# PaymentMonitorService's Polling Interval

**Purpose:** Document the `PAYMENT_POLL_INTERVAL_MS` environment variable and its default value.

## Polling Configuration

The `PaymentMonitorService` uses a polling mechanism to check for inbound payments for accounts in the `PENDING_PAYMENT` state. The interval for this polling is configured via the `PAYMENT_POLL_INTERVAL_MS` environment variable.

-   **Default Value:** If `PAYMENT_POLL_INTERVAL_MS` is not set, it defaults to `30000` milliseconds (30 seconds).
-   **Configuration Location:** This value is read and applied in the `onModuleInit` method of the `payment-monitor.service.ts` file.

## Scheduler Implementation

The polling is implemented using a simple `setInterval`. This means that the polling function is called at the specified interval, regardless of whether the previous polling cycle has completed. This is not a queue-based or cron-based scheduler.

## Overlapping Ticks

Due to the use of `setInterval`, it is possible for polling cycles to overlap if a single cycle takes longer to complete than the configured interval. For more details on this behavior and its implications, please refer to the integration notes on overlapping-tick behavior.

*Note: The cross-reference to the integration notes on overlapping-tick behavior is a placeholder and should be updated when the document is available.*