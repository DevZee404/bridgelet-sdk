# Why does `recordPayment()` need a `signerSecret` if the contract does not check authorization?

Because every Soroban transaction needs a source account that pays the fee and signs the transaction. Calling a contract function does not remove that transaction-level requirement. The SDK uses `signerSecret` to derive that source account, build the transaction, sign it, and submit it.

That requirement is separate from authorization inside the contract function:

- **Transaction submitter:** the account whose key signs the transaction and whose balance pays its fee.
- **Contract authorization:** the identity or identities that the contract code verifies before allowing the requested state change.

For `recordPayment()`, the SDK currently uses the configured funding signer as a convention. The contract-side logic documented in [record_payment Trust Assumption](../integration-notes/record-payment-trust-assumption.md) does not verify that the transaction signer is the funding account or another required caller. A different funded account could therefore submit the call if it supplied otherwise valid arguments.

The practical takeaway is that the `signerSecret` identifies who pays for and submits the transaction, but it is not currently an on-chain guarantee of who is authorized to record the payment. That identity remains an SDK and deployment convention until the contract-side authorization gap is closed.
