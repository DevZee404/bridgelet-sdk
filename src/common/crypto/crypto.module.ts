import { Global, Module } from '@nestjs/common';
import { KmsKeyProvider } from './kms-key.provider.js';
import { JwtKeyRotationProvider } from './jwt-key-rotation.provider.js';

@Global()
@Module({
  providers: [KmsKeyProvider, JwtKeyRotationProvider],
  exports: [KmsKeyProvider, JwtKeyRotationProvider],
})
export class CryptoModule {}
