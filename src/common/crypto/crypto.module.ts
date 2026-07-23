import { Global, Module } from '@nestjs/common';
import { KmsKeyProvider } from './kms-key.provider.js';

@Global()
@Module({
  providers: [KmsKeyProvider],
  exports: [KmsKeyProvider],
})
export class CryptoModule {}
