import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Response } from 'express';
import { AdminGuard, ClientIp, CurrentAdmin, Roles, type AdminPrincipal } from '../auth/guards.js';
import { TokensService } from '../auth/tokens.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { diffConfig } from '@sanad/config';
import { AdminService, LEGAL_STATUSES } from './admin.service.js';

class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @Length(12, 200) password!: string;
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/) totp!: string;
}
class RefreshDto {
  @ApiProperty() @IsString() @Length(20, 200) refreshToken!: string;
}
class ReasonDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) reason?: string;
}
class ConfigDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() config!: Record<
    string,
    unknown
  >;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) notes?: string;
}
class CapitalDto {
  @ApiProperty({ example: '5000000', description: 'fils' })
  @Matches(/^\d{1,13}$/)
  amountFils!: string;
  @ApiProperty({ example: 'launch-reserve-2027' })
  @Matches(/^[A-Za-z0-9_-]{3,60}$/)
  reference!: string;
}
class LegalUpdateDto {
  @ApiProperty({ enum: LEGAL_STATUSES })
  @IsIn(LEGAL_STATUSES)
  status!: (typeof LEGAL_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) note?: string;
  @ApiPropertyOptional({ description: 'recovered amount in fils' })
  @IsOptional()
  @Matches(/^\d{1,13}$/)
  recoveredFils?: string;
}

@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly admin: AdminService,
    private readonly tokens: TokensService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @ClientIp() ip: string | null) {
    return this.admin.login(dto.email, dto.password, dto.totp, ip);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.tokens.rotate('admin', dto.refreshToken);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly settings: SettingsService,
  ) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('kyc')
  @Roles('kyc_reviewer', 'ops')
  kyc(@Query('status') status?: string) {
    return this.admin.kycQueue(status);
  }

  @Get('kyc/:id')
  @Roles('kyc_reviewer')
  kycDetail(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ) {
    return this.admin.kycDetail(a, id, ip);
  }

  @Get('kyc/:id/documents/:which')
  @Roles('kyc_reviewer')
  async kycDoc(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('which') which: string,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ) {
    if (!['front', 'back', 'selfie'].includes(which))
      return res.status(404).json({ code: 'NOT_FOUND', message: 'document not found' });
    const doc = await this.admin.kycDocument(a, id, which as 'front' | 'back' | 'selfie', ip);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(doc.data);
  }

  @Post('kyc/:id/approve')
  @HttpCode(204)
  @Roles('kyc_reviewer')
  async approve(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalReasonDto,
  ): Promise<void> {
    await this.admin.reviewKyc(a, id, 'APPROVED', dto.reason ?? null);
  }

  @Post('kyc/:id/reject')
  @HttpCode(204)
  @Roles('kyc_reviewer')
  async reject(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ): Promise<void> {
    await this.admin.reviewKyc(a, id, 'REJECTED', dto.reason);
  }

  @Get('circles')
  circles(@Query('status') status?: string) {
    return this.admin.listCircles(status);
  }

  @Get('circles/:id')
  circle(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.circleDetail(id);
  }

  @Get('members/:id')
  @Roles('ops', 'finance', 'legal')
  member(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.member(id);
  }

  @Post('members/:id/ban')
  @Roles('ops')
  ban(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.setBan(a, id, true, dto.reason);
  }

  @Post('members/:id/unban')
  @Roles('ops')
  unban(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.setBan(a, id, false, dto.reason);
  }

  @Get('config')
  config() {
    return this.settings.active();
  }

  @Post('config/preview')
  @HttpCode(200)
  @Roles('super_admin')
  async preview(@Body() dto: ConfigDto) {
    const { config } = await this.settings.active();
    return { diff: diffConfig(config, dto.config) };
  }

  @Post('config')
  @Roles('super_admin')
  publish(@CurrentAdmin() a: AdminPrincipal, @Body() dto: ConfigDto) {
    return this.admin.publishConfig(a, dto.config, dto.notes ?? null);
  }

  @Post('fund/capital')
  @Roles('finance')
  capital(@CurrentAdmin() a: AdminPrincipal, @Body() dto: CapitalDto) {
    return this.admin.injectCapital(a, BigInt(dto.amountFils), dto.reference);
  }

  @Get('ledger/accounts')
  @Roles('finance')
  accounts() {
    return this.admin.ledgerAccounts();
  }

  @Get('ledger/transactions')
  @Roles('finance')
  transactions(@Query('circleId') circleId?: string) {
    return this.admin.ledgerTransactions(circleId);
  }

  @Get('disbursements')
  @Roles('ops', 'finance')
  disbursements(@Query('status') status?: string) {
    return this.admin.disbursementsList(status);
  }

  @Post('disbursements/:kind/:id/retry')
  @HttpCode(204)
  @Roles('ops')
  async retry(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.admin.retryDisbursement(a, kind === 'refund' ? 'refund' : 'payout', id);
  }

  @Get('legal/cases')
  @Roles('legal')
  legal() {
    return this.admin.legalCases();
  }

  @Post('legal/cases/:id')
  @Roles('legal')
  updateLegal(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LegalUpdateDto,
  ) {
    return this.admin.updateLegalCase(
      a,
      id,
      dto.status,
      dto.note ?? null,
      dto.recoveredFils ? BigInt(dto.recoveredFils) : null,
    );
  }

  @Get('audit')
  @Roles('super_admin')
  audit(@Query('limit') limit?: string) {
    return this.admin.auditLog(Math.min(Number(limit ?? 200) || 200, 1000));
  }

  @Post('jobs/tick')
  @HttpCode(200)
  @Roles('ops')
  tick(@CurrentAdmin() a: AdminPrincipal) {
    return this.admin.runTick(a);
  }
}
