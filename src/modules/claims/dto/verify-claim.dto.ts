import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyClaimDto {
  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2NvdW50SWQiOiI0ZWJhZTMzYi01YjkzLTQyNGMtODU4ZC1kNzlhZmM3MDhhZjUiLCJjbGFpbVRva2VuSGFzaCI6ImQzZjJhMjhjOWE5YzQ5NTQ2MzA0YWE3ZjA4YmQ2YjkxIn0.P7z6qW8xYzK3mN2vP5rS9tU4vW1xY3zK7mN9oP2qR5',
    description: 'JWT claim token extracted from the claim URL',
  })
  @IsString({
    message: 'claimToken must be a string',
  })
  @IsNotEmpty({
    message: 'claimToken is required',
  })
  claimToken: string;
}
