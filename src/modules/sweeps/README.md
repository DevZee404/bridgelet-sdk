## Usage

### Execute a Sweep

```typescript
const result = await sweepsService.executeSweep({
  accountId: '550e8400-e29b-41d4-a716-446655440000',
  ephemeralPublicKey:
    'GEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  ephemeralSecret: 'S...REDACTED_FOR_DOCS...',
  destinationAddress:
    'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN',
  amount: '100.0000000',
  asset: 'native',
});

// Result:
// {
//   success: true,
//   txHash: 'abc123...',
//   contractAuthHash: 'def456...',
//   amountSwept: '100.0000000',
//   destination: 'GDEST...',
//   timestamp: Date
// }
```

### Check if Account Can Be Swept

```typescript
const canSweep = await sweepsService.canSweep(accountId, destinationAddress);

if (canSweep) {
  // Proceed with sweep
}
```

### Get Detailed Sweep Status

```typescript
const status = await sweepsService.getSweepStatus(accountId);

// Possible responses:
// { canSweep: true }
// { canSweep: false, reason: 'Account not found' }
// { canSweep: false, reason: 'Already swept' }
// { canSweep: false, reason: 'Account expired' }
// { canSweep: false, reason: 'Payment not received' }
```

## Testing

### Run All Tests

```bash
npm run test -- sweeps
```

### Run Specific Provider Tests

```bash
npm run test -- validation.provider.spec
npm run test -- contract.provider.spec
npm run test -- transaction.provider.spec
npm run test -- sweeps.service.spec
```

### Coverage

```bash
npm run test:cov -- sweeps
```

**Coverage Goals:**

- Statements: >90%
- Branches: >85%
- Functions: >90%
- Lines: >90%

### Manual End-to-End Testing

1. Create funded ephemeral account on testnet
2. Execute sweep with valid parameters:

````bash
curl -X POST http://localhost:3000/api/sweeps \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "...",
    "ephemeralPublicKey": "...",
    "ephemeralSecret": "...",
    "destinationAddress": "...",
    "amount": "100",
    "asset": "native"
    }'
3. Verify transaction on Stellar Explorer
4. Check destination account received funds
5. Verify ephemeral account merged (if successful)

## Configuration

### Required Environment Variables
```env
# Stellar Network
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Smart Contract
EPHEMERAL_ACCOUNT_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
````

### Network Selection

- **Testnet:** Use for development and testing
- **Mainnet:** Production only (real money!)

Network determines:

- Horizon URL
- Soroban RPC URL
- Network passphrase
- Contract deployment

## Deployment

### Prerequisites

1. Deploy ephemeral account contract to target network
2. Note contract ID
3. Configure environment variables
4. Fund accounts for testing

### Security Considerations

1. **Secret Key Handling:**
   - Ephemeral secrets are temporary
   - Never log secret keys
   - Clear from memory after use

2. **Authorization Signatures:**
   - MVP uses dummy signatures
   - Production must implement proper Ed25519 signing
   - Use authorized SDK keys

3. **Transaction Verification:**
   - Always verify transaction success
   - Check ledger confirmation
   - Monitor for failed transactions

4. **Rate Limiting:**
   - Implement rate limits on sweep endpoints
   - Prevent DOS attacks
   - Monitor for suspicious patterns

## Future Improvements

### Short Term

1. **Production Signature Implementation:**
   - Replace dummy signatures with real Ed25519
   - Sign with authorized SDK private key
   - Verify signatures in contract

2. **On-Chain Authorization Enforcement:**
   - Submit contract transactions
   - Enforce authorization on-chain
   - Store sweep records in contract

3. **Enhanced Validation:**
   - Check destination account exists
   - Verify destination can receive asset
   - Validate minimum amounts

### Long Term

1. **Batch Sweeps:**
   - Sweep multiple accounts in one transaction
   - Reduce transaction fees
   - Improve efficiency

2. **Gas Optimization:**
   - Optimize contract calls
   - Reduce transaction sizes
   - Minimize operations

3. **Monitoring & Alerts:**
   - Real-time sweep monitoring
   - Alert on failures
   - Track success rates

4. **Retry Mechanisms:**
   - Automatic retry for failed transactions
   - Exponential backoff
   - Dead letter queue for persistent failures

## Troubleshooting

### Common Issues

## Operator Runbook: Resolving Dead-Lettered Sweeps

### Overview

When a sweep exhausts all automatic retry attempts (default: 5 retries with exponential backoff), it is moved to the **Dead-Letter Queue (DLQ)**. This requires immediate operator intervention to prevent funds from becoming permanently stuck on an ephemeral account.

### Alerting

You will receive alerts when:

1. A sweep is moved to the DLQ (critical error logged with `ALERT:` prefix)
2. The Prometheus metric `sweep_deadletter_total` increases
3. The `deadLetterCount` (number of unresolved DLQ entries) is greater than 0 in monitoring dashboards

### Step 1: Identify the Dead-Letter Entry

1. List all unresolved dead-lettered sweeps:
   ```bash
   curl http://localhost:3000/api/sweeps/dead-letter
   ```
2. Retrieve detailed information about a specific entry:
   ```bash
   curl http://localhost:3000/api/sweeps/dead-letter/<DLQ_ENTRY_ID>
   ```
   This will return:
   - The account ID affected
   - Total number of attempts made
   - Timestamp when it was moved to DLQ
   - The last error message that caused failure
   - The original sweep ID from the retry queue

### Step 2: Diagnose the Root Cause

Common causes for sweeps to reach the DLQ:

1. **Horizon connectivity issues**: Temporary network problems that persisted longer than the retry window
2. **Insufficient funds on destination account**: Destination couldn't accept the payment (e.g., missing minimum reserve)
3. **Stellar network congestion**: Transactions were timing out repeatedly
4. **Invalid destination address**: Destination address was incorrect or no longer exists
5. **Asset support issues**: Destination account doesn't trust the asset being swept

### Step 3: Manually Resolve the Sweep

Once you've identified and fixed the root cause:

1. **Option A: Retry the sweep manually**
   - Re-execute the sweep using the original account details
   - Verify the transaction succeeds on Stellar Explorer

2. **Option B: Perform a manual rescue transaction**
   - If the ephemeral account's secret key is still available, manually construct and submit a payment transaction from the ephemeral account to the destination
   - Attempt the account merge operation to reclaim the minimum XLM reserve

### Step 4: Mark the DLQ Entry as Resolved

After successfully rescuing the funds:

```bash
curl -X PATCH http://localhost:3000/api/sweeps/dead-letter/<DLQ_ENTRY_ID>/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "resolutionNotes": "Manually submitted transaction, succeeded on ledger 123456789. Root cause: temporary Horizon outage."
  }'
```

### Step 5: Verify Resolution

- Confirm the DLQ entry is marked as resolved: `curl http://localhost:3000/api/sweeps/dead-letter/<DLQ_ENTRY_ID>`
- Check that the Prometheus metric `sweep_deadletter_resolved_total` has increased
- Verify funds are present in the destination account via Stellar Explorer

### Preventive Measures

After resolving a dead-lettered sweep:

1. Investigate why the automatic retries failed to prevent recurrence
2. Adjust retry parameters (max attempts, backoff timing) if needed
3. Update monitoring thresholds if this was a systemic issue
4. Document any new failure modes encountered in this runbook

### API Reference for DLQ Operations

| Endpoint                                   | Method | Description                                    |
| ------------------------------------------ | ------ | ---------------------------------------------- |
| `/sweeps/dead-letter`                      | GET    | List all unresolved dead-letter entries        |
| `/sweeps/dead-letter?includeResolved=true` | GET    | List all entries including resolved ones       |
| `/sweeps/dead-letter/{id}`                 | GET    | Get specific DLQ entry details                 |
| `/sweeps/dead-letter/account/{accountId}`  | GET    | Get all DLQ entries for a specific account     |
| `/sweeps/dead-letter/{id}/resolve`         | PATCH  | Mark DLQ entry as resolved with optional notes |

**Transaction Fails with "op_underfunded":**

- Ephemeral account has insufficient XLM for fee
- Need minimum 0.5 XLM for transaction fees

**Account Merge Fails:**

- Check for active offers: `account.offers().call()`
- Check for trustlines: `account.balances`
- Remove before merging

**Contract Simulation Fails:**

- Verify contract ID is correct
- Check Soroban RPC URL
- Ensure contract is deployed on network

**Address Validation Fails:**

- Stellar addresses are 56 characters
- Must start with 'G'
- Use `StrKey.isValidEd25519PublicKey()`

### Debug Logging

Enable debug logs:

```typescript
Logger.overrideLogger(['log', 'debug', 'error', 'warn']);
```

Check logs for:

- Validation failures
- Contract simulation errors
- Transaction extras (Horizon errors)
- Account merge warnings

## Support

For issues or questions:

1. Check this README
2. Review test files for examples
3. Check Stellar documentation
4. Open GitHub issue
