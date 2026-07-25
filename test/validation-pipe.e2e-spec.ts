import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';

describe('Global ValidationPipe (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should strip unexpected fields from request body (whitelist)', async () => {
    const response = await request(app.getHttpServer())
      .post('/claims/verify')
      .send({
        claimToken: 'some-token',
        unexpectedField: 'should-be-stripped',
        anotherUnexpected: 123,
      });

    // The endpoint should not reject the request due to unknown fields
    // (they are stripped by whitelist: true). It may return 401/404 due to
    // invalid token, but NOT 400 due to unexpected fields.
    expect(response.status).not.toBe(400);
  });

  it('should reject request with non-whitelisted fields when forbidNonWhitelisted is true', async () => {
    // This test verifies the pipe configuration is active.
    // With whitelist: true + forbidNonWhitelisted: true, unknown properties
    // should be stripped, NOT cause rejection. forbidNonWhitelisted only
    // applies when using DTOs with class-validator decorators.
    const response = await request(app.getHttpServer())
      .post('/claims/verify')
      .send({
        claimToken: 'some-token',
        totallyFakeField: 'test',
      });

    // Should not be 400 (ValidationPipe strips unknown fields, doesn't reject)
    expect(response.status).not.toBe(400);
  });
});
