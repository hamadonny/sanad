import { Global, Module } from '@nestjs/common';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { ENV, loadEnv, type Env } from '../config/env.js';
import {
  IDENTITY_PROVIDER,
  ManualReviewProvider,
  MockIdentityProvider,
} from './identity.provider.js';
import {
  MockPushProvider,
  MockSmsProvider,
  PUSH_PROVIDER,
  SMS_PROVIDER,
} from './messaging.provider.js';
import { MockPaymentProvider, PAYMENT_PROVIDER } from './payment.provider.js';
import { CryptoSeedSource, SEED_SOURCE } from './seed.source.js';
import {
  LocalEncryptedStorage,
  PDF_GENERATOR,
  PlaceholderPdfGenerator,
  STORAGE_PROVIDER,
} from './storage.provider.js';

/** Global infrastructure: env, crypto, clock and every external provider (all mocks). */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    CryptoService,
    ClockService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) => new MockPaymentProvider(env.PAYMENT_WEBHOOK_SECRET),
    },
    {
      provide: IDENTITY_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.IDENTITY_PROVIDER === 'mock'
          ? new MockIdentityProvider(env.MOCK_KYC_AUTO_APPROVE)
          : new ManualReviewProvider(),
    },
    { provide: SMS_PROVIDER, useFactory: () => new MockSmsProvider() },
    { provide: PUSH_PROVIDER, useFactory: () => new MockPushProvider() },
    {
      provide: STORAGE_PROVIDER,
      inject: [ENV, CryptoService],
      useFactory: (env: Env, c: CryptoService) => new LocalEncryptedStorage(env.STORAGE_DIR, c),
    },
    { provide: PDF_GENERATOR, useFactory: () => new PlaceholderPdfGenerator() },
    {
      provide: SEED_SOURCE,
      inject: [CryptoService],
      useFactory: (c: CryptoService) => new CryptoSeedSource(c),
    },
  ],
  exports: [
    ENV,
    CryptoService,
    ClockService,
    PAYMENT_PROVIDER,
    IDENTITY_PROVIDER,
    SMS_PROVIDER,
    PUSH_PROVIDER,
    STORAGE_PROVIDER,
    PDF_GENERATOR,
    SEED_SOURCE,
  ],
})
export class ProvidersModule {}
