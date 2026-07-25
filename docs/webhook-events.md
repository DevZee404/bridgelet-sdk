# Webhook Events

This document provides a detailed description of each webhook event, including the event name, trigger condition, a full JSON payload example, and HMAC verification code samples.

## `account.created`

Triggered when an ephemeral account is provisioned and funded.

### Payload Example

```json
{
  "id": "evt_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "event": "account.created",
  "accountId": "acc_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "amount": "100.0000000",
  "asset": "USDC:GBBD47IF6LWK7P7MHY3KUX7W2V6WOPARAUI3VLH22XXBHUSA7NINWY4F",
  "expiresAt": "2024-01-01T00:00:00.000Z",
  "metadata": {
    "orderId": "12345"
  }
}
```

## `account.expired`

Triggered when an ephemeral account expires.

### Payload Example

```json
{
  "id": "evt_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "event": "account.expired",
  "accountId": "acc_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "amount": "100.0000000",
  "asset": "USDC:GBBD47IF6LWK7P7MHY3KUX7W2V6WOPARAUI3VLH22XXBHUSA7NINWY4F",
  "metadata": {
    "orderId": "12345"
  }
}
```

## `sweep.completed`

Triggered when funds are successfully swept to a destination.

### Payload Example

```json
{
  "id": "evt_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "event": "sweep.completed",
  "accountId": "acc_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "amount": "100.0000000",
  "asset": "USDC:GBBD47IF6LWK7P7MHY3KUX7W2V6WOPARAUI3VLH22XXBHUSA7NINWY4F",
  "destination": "G...",
  "txHash": "...",
  "sweptAt": "2024-01-01T00:00:00.000Z",
  "metadata": {
    "orderId": "12345"
  }
}
```

## `sweep.partial`

Triggered when smart contract authorization succeeds but Horizon transfer fails.

### Payload Example

```json
{
  "id": "evt_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "event": "sweep.partial",
  "accountId": "acc_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "amount": "100.0000000",
  "asset": "USDC:GBBD47IF6LWK7P7MHY3KUX7W2V6WOPARAUI3VLH22XXBHUSA7NINWY4F",
  "destination": "G...",
  "error": "...",
  "contractAuthHash": "..."
}
```

## `sweep.failed`

Triggered when sweep execution fails completely.

### Payload Example

```json
{
  "id": "evt_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "event": "sweep.failed",
  "accountId": "acc_1J3Z4Y2eZvKYlo2C0T4Q5R6p",
  "amount": "100.0000000",
  "asset": "USDC:GBBD47IF6LWK7P7MHY3KUX7W2V6WOPARAUI3VLH22XXBHUSA7NINWY4F",
  "destination": "G...",
  "error": "...",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## HMAC Verification

### TypeScript

```typescript
import * as crypto from 'crypto';

const secret = 'your-webhook-secret';
const signature = request.headers['x-bridgelet-signature'];
const body = request.rawBody;

const hmac = crypto.createHmac('sha256', secret);
const digest = `sha256=${hmac.update(body).digest('hex')}`;

if (digest !== signature) {
  // Invalid signature
}
```

### Python

```python
import hashlib
import hmac

secret = b'your-webhook-secret'
signature = request.headers.get('X-Bridgelet-Signature')
body = request.get_data()

digest = 'sha256=' + hmac.new(secret, body, hashlib.sha256).hexdigest()

if not hmac.compare_digest(digest, signature):
  # Invalid signature
```

### Go

```go
import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
)

func verifySignature(r *http.Request, body []byte) bool {
	secret := []byte("your-webhook-secret")
	signature := r.Header.Get("X-Bridgelet-Signature")

	mac := hmac.New(sha256.New, secret)
	mac.Write(body)
	expectedSignature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}
```