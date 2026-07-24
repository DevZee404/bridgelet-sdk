import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

interface SigningKey {
  kid: string;
  secret: string;
}

interface JwksKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
}

@Injectable()
export class JwtKeyRotationProvider {
  private readonly logger = new Logger(JwtKeyRotationProvider.name);
  private readonly keys: SigningKey[] = [];

  constructor(private readonly configService: ConfigService) {
    const currentSecret = this.configService.getOrThrow<string>('app.jwtSecret');
    this.keys.push({ kid: this.generateKid(currentSecret), secret: currentSecret });

    const previousSecret = this.configService.get<string>('app.jwtPreviousSecret');
    if (previousSecret) {
      this.keys.push({ kid: this.generateKid(previousSecret), secret: previousSecret });
      this.logger.log('JWT key rotation: loaded current and previous signing keys');
    } else {
      this.logger.log('JWT key rotation: loaded single signing key');
    }
  }

  /**
   * Sign a JWT with the current (first) signing key.
   * Adds a `kid` header so verifiers can identify the correct key.
   */
  sign(payload: Record<string, unknown>, options?: jwt.SignOptions): string {
    const currentKey = this.keys[0];
    const opts: jwt.SignOptions = {
      ...options,
      header: {
        kid: currentKey.kid,
        alg: 'HS256',
      },
    };
    return jwt.sign(payload, currentKey.secret, opts);
  }

  /**
   * Verify a JWT by matching the `kid` header against known keys.
   * Falls back to trying all keys when `kid` is absent (backward compat).
   */
  verify<T extends Record<string, unknown>>(token: string): T {
    const decoded = jwt.decode(token, { complete: true });
    const kid = decoded?.header?.kid as string | undefined;

    if (kid) {
      const key = this.keys.find((k) => k.kid === kid);
      if (!key) {
        throw new Error(`Unknown JWT kid: ${kid}`);
      }
      return jwt.verify(token, key.secret) as T;
    }

    // No kid header — try all keys (backward compatibility)
    let lastError: Error | undefined;
    for (const key of this.keys) {
      try {
        return jwt.verify(token, key.secret) as T;
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw lastError ?? new Error('No signing keys available');
  }

  /**
   * Return the JWKS key set for this instance.
   * For HMAC-based keys, we expose the key ID and algorithm but NOT the
   * secret. Clients that need to verify locally must obtain the secret
   * through a secure channel.
   */
  getJwks(): { keys: JwksKey[] } {
    return {
      keys: this.keys.map((k) => ({
        kid: k.kid,
        kty: 'oct',
        alg: 'HS256',
        use: 'sig',
      })),
    };
  }

  /**
   * Derive a stable key ID from a signing secret using SHA-256.
   * The kid is the first 16 hex characters of the hash.
   */
  private generateKid(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
  }
}
