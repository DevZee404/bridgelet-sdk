# Postmortem: Payment Monitor Single Asset Limitation

## Issue Summary

The payment monitor was designed to only sweep a single pre-configured asset per ephemeral account, leading to ignored payments when users erroneously sent multiple different assets or an unexpected asset to the same invoice address.

## Root Cause

The `AccountObserver` logic hardcoded a strict filter against a single `assetCode`/`issuer`. The Soroban smart contract, however, theoretically supports sweeping any arbitrary asset. The limitation was entirely off-chain in the SDK's parsing layer.

## Resolution

Refactored the payment monitor to track the entire balance state of the ephemeral account. Any asset received that has a configured `resolveAssetAddress` mapping is now swept, and a `payment.detected` webhook is sent with an array of received assets rather than a single amount.
