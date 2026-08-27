# Is it safe for `record_payment` to be called by anything other than this SDK's payment monitor?

On the contract side, currently yes: anyone can call `record_payment`, according to bridgelet-audit's [`record-payment-unauthenticated-write.md`](https://github.com/bridgelet-org/bridgelet-audit/blob/main/record-payment-unauthenticated-write.md).

For this SDK, that means the `signerSecret` requirement does not add an on-chain authorization guarantee today. It supplies the transaction source account that pays the fee and signs the transaction, but the contract currently does not verify that the signer is this SDK's payment monitor, the configured funding account, or another required caller. The signer requirement is therefore an SDK submission convention, not contract-side access control.

The underlying contract-side fix is tracked in the [bridgelet-core issues filtered for `record_payment`](https://github.com/bridgelet-org/bridgelet-core/issues?q=is%3Aissue+record_payment). Check that issue before treating this behavior as resolved.
