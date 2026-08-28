import 'reflect-metadata';
import 'dotenv/config';
import { promises as fs } from 'fs';
import * as crypto from 'crypto';
import path from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { NestFactory } from '@nestjs/core';
import * as StellarSdk from '@stellar/stellar-sdk';
import databaseConfig from '../src/config/database.config.js';
import appConfig from '../src/config/app.config.js';
import { CryptoModule } from '../src/common/crypto/crypto.module.js';
import { JwtKeyRotationProvider } from '../src/common/crypto/jwt-key-rotation.provider.js';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Account } from '../src/modules/accounts/entities/account.entity.js';
import { AccountStatus } from '../src/modules/accounts/enums/account-status.enum.js';
import { Repository } from 'typeorm';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig, appConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => {
        const cfg =
          configService.get<TypeOrmModuleOptions>('database.database');
        if (!cfg) {
          throw new Error('database.database config missing.');
        }
        return cfg;
      },
    }),
    TypeOrmModule.forFeature([Account]),
    CryptoModule,
  ],
})
class SeedLoadTestClaimsModule {}

/**
 * Seeds ephemeral accounts in PENDING_CLAIM with valid claim tokens so that
 * `POST /claims/redeem` can be load-tested without depending on the full
 * Stellar funding/sweep pipeline. Writes `load-tests/claim-tokens.csv`
 * (fields: token, destination) consumed by the artillery claims-redeem-burst
 * scenario.
 */
async function main(): Promise<void> {
  const count = parseInt(process.argv[2] ?? '50', 10);
  if (Number.isNaN(count) || count <= 0) {
    throw new Error('Usage: npm run load:claims:seed -- <count>');
  }

  const outputPath = path.resolve('load-tests/claim-tokens.csv');
  const app = await NestFactory.createApplicationContext(
    SeedLoadTestClaimsModule,
    { logger: false },
  );

  try {
    const jwtKeyRotation = app.get(JwtKeyRotationProvider);
    const accountsRepository = app.get<Repository<Account>>(
      getRepositoryToken(Account),
    );
    const claimTokenExpiry =
      app.get(ConfigService).get<number>('app.claimTokenExpiry') ?? 2592000;

    const lines = ['claimToken,destinationAddress'];
    for (let index = 1; index <= count; index += 1) {
      const keypair = StellarSdk.Keypair.random();
      const claimToken = jwtKeyRotation.sign(
        { publicKey: keypair.publicKey(), type: 'claim' },
        { expiresIn: `${claimTokenExpiry}s` },
      );
      const claimTokenHash = crypto
        .createHash('sha256')
        .update(claimToken)
        .digest('hex');
      const destination = StellarSdk.Keypair.random().publicKey();
      const expiresAt = new Date(Date.now() + claimTokenExpiry * 1000);

      await accountsRepository.insert({
        publicKey: keypair.publicKey(),
        fundingSource: StellarSdk.Keypair.random().publicKey(),
        amount: '100',
        asset: 'native',
        status: AccountStatus.PENDING_CLAIM,
        claimTokenHash,
        expiresAt,
      });
      lines.push(`${claimToken},${destination}`);
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, lines.join('\n'), { encoding: 'utf8' });
    process.stdout.write(`Wrote ${count} claim tokens to ${outputPath}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`FATAL: ${message}\n`);
  process.exit(1);
});
