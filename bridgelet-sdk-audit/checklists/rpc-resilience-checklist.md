# RPC Resilience and Timeout-Handling Checklist

## Timeout Configuration

- [ ] Are all RPC calls configured with explicit, reasonable timeouts (e.g., 10s for simulation, 30s for submission)?
- [ ] Do timeouts correctly abort the underlying network requests to prevent hanging promises?

## Fallback Strategies

- [ ] Does the SDK retry failed RPC calls using exponential backoff?
- [ ] Is there support for multiple RPC endpoints with automatic failover?
- [ ] Are rate limits (HTTP 429) handled gracefully without crashing the process?

## Error Classification

- [ ] Are network timeouts clearly distinguished from contract execution failures in the logs?
