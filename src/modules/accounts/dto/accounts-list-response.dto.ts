import { ApiProperty } from '@nestjs/swagger';
import { AccountResponseDto } from './account-response.dto.js';

export class AccountsListResponseDto {
  @ApiProperty({
    description: 'Array of ephemeral account records',
    type: [AccountResponseDto],
  })
  accounts: AccountResponseDto[];

  @ApiProperty({
    description: 'Total number of accounts matching the query (for pagination)',
    example: 150,
  })
  total: number;
}
