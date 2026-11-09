import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { SessionThrottlerGuard } from './common/throttler.guard.js';
import {
  AdminAuthController,
  AdminController,
  PublicContentController,
} from './admin/admin.controller.js';
import { AdminViewsService } from './admin/admin-views.service.js';
import { ContentService } from './admin/content.service.js';
import { CaseFilesService } from './admin/case-files.service.js';
import { LegalDocsService } from './contracts/legal-docs.service.js';
import { TelemetryController } from './telemetry/telemetry.controller.js';
import { TelemetryService } from './telemetry/telemetry.service.js';
import { AdminService } from './admin/admin.service.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AdminGuard, MemberGuard } from './auth/guards.js';
import { TokensService } from './auth/tokens.service.js';
import { CircleStore } from './circles/circle-store.js';
import { CirclesController } from './circles/circles.controller.js';
import { CirclesService } from './circles/circles.service.js';
import { ErrorFilter } from './common/errors.js';
import { ContractsService } from './contracts/contracts.service.js';
import { DbModule } from './db/db.module.js';
import { DevController } from './dev/dev.controller.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { JobsService } from './jobs/jobs.service.js';
import { SchedulerService } from './jobs/scheduler.service.js';
import { KycService } from './kyc/kyc.service.js';
import { LedgerRepository } from './ledger/ledger.repository.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { DisbursementService } from './payments/disbursement.service.js';
import { PaymentsController } from './payments/payments.controller.js';
import { PaymentsService } from './payments/payments.service.js';
import { ProvidersModule } from './providers/providers.module.js';
import { SettingsService } from './settings/settings.service.js';
import { MembersController } from './users/members.controller.js';
import { MembersService } from './users/members.service.js';

const THROTTLE_OFF = process.env.NODE_ENV === 'test';

@Module({
  imports: [
    DbModule,
    ProvidersModule,
    ThrottlerModule.forRoot({
      // Per session (or per IP when signed out); see SessionThrottlerGuard.
      throttlers: [{ ttl: 60_000, limit: Number(process.env.THROTTLE_PER_MINUTE ?? 300) }],
      skipIf: () => THROTTLE_OFF,
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    MembersController,
    CirclesController,
    PaymentsController,
    AdminAuthController,
    AdminController,
    PublicContentController,
    TelemetryController,
    DevController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ErrorFilter },
    { provide: APP_GUARD, useClass: SessionThrottlerGuard },
    AuditService,
    SettingsService,
    LedgerRepository,
    NotificationsService,
    TokensService,
    AuthService,
    MemberGuard,
    AdminGuard,
    MembersService,
    KycService,
    ContractsService,
    CircleStore,
    CirclesService,
    DisbursementService,
    PaymentsService,
    SchedulerService,
    JobsService,
    AdminService,
    AdminViewsService,
    ContentService,
    CaseFilesService,
    LegalDocsService,
    TelemetryService,
    HealthService,
  ],
})
export class AppModule {}
