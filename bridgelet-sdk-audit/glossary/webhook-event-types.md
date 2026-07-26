# Webhook Event Types

The Bridgelet SDK emits the following webhook event types to integrators:

- `payment.detected`: Emitted when an incoming payment is seen on the network but is pending confirmation or balance threshold checks.
- `payment.confirmed`: Emitted when a payment is fully confirmed and balances are ready for sweeping.
- `payment.failed`: Emitted if a detected payment is deemed invalid (e.g., wrong asset).
- `sweep.initiated`: Emitted when a sweep transaction is submitted to the network.
- `sweep.completed`: Emitted when a sweep is confirmed successful on-chain.
- `sweep.failed`: Emitted if a sweep transaction fails or times out.
