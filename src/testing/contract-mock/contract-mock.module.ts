import { Global, Module } from '@nestjs/common';
import { MockContractProvider } from './mock-contract.provider.js';

@Global()
@Module({
  providers: [MockContractProvider],
  exports: [MockContractProvider],
})
export class ContractMockModule {}
