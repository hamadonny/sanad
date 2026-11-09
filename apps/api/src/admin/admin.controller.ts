import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AdminMe, AdminOverview } from '@sanad/api-client';
import { toCsv } from '../common/csv.js';
import { notFound } from '../common/errors.js';
import { AdminViewsService } from './admin-views.service.js';
import { ContentService, TICKET_STATUSES } from './content.service.js';
import { CaseFilesService } from './case-files.service.js';
import { sendFile, sendPdf } from '../common/send-file.js';
import { ContractsService } from '../contracts/contracts.service.js';
import {
  LEGAL_DOC_KINDS,
  LegalDocsService,
  MAX_LEGAL_DOC_BYTES,
  SHARIAH_STATUSES,
} from '../contracts/legal-docs.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import type { Response } from 'express';
import { AdminGuard, ClientIp, CurrentAdmin, Roles, type AdminPrincipal } from '../auth/guards.js';
import { TokensService } from '../auth/tokens.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { diffConfig, validateConfig } from '@sanad/config';
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

class TemplateDto {
  @ApiProperty() @IsString() @Length(1, 120) title!: string;
  @ApiProperty() @IsString() @Length(1, 1000) body!: string;
}
class ContractDto {
  @ApiProperty() @IsString() @Length(3, 300) titleAr!: string;
  @ApiProperty() @IsString() @Length(3, 300) titleEn!: string;
  @ApiProperty() @IsString() @Length(20, 100_000) bodyAr!: string;
  @ApiProperty() @IsString() @Length(20, 100_000) bodyEn!: string;
}
class FaqDto {
  @ApiProperty() @IsString() @Length(3, 300) questionAr!: string;
  @ApiProperty() @IsString() @Length(3, 4000) answerAr!: string;
  @ApiProperty() @IsString() @Length(3, 300) questionEn!: string;
  @ApiProperty() @IsString() @Length(3, 4000) answerEn!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) position?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() published?: boolean;
}
class TicketDto {
  @ApiProperty({ enum: TICKET_STATUSES })
  @IsIn(TICKET_STATUSES)
  status!: (typeof TICKET_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

class LegalDocDto {
  @ApiProperty({ enum: LEGAL_DOC_KINDS })
  @IsIn(LEGAL_DOC_KINDS)
  kind!: (typeof LEGAL_DOC_KINDS)[number];
  @ApiProperty() @IsString() @Length(3, 200) title!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contractVersion?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) reviewer?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) reviewedOn?: string;
  @ApiPropertyOptional({ enum: SHARIAH_STATUSES })
  @IsOptional()
  @IsIn(SHARIAH_STATUSES)
  status?: (typeof SHARIAH_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

const EXPORTS = ['ledger', 'accounts', 'revenue'] as const;

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
    private readonly views: AdminViewsService,
    private readonly content: ContentService,
    private readonly settings: SettingsService,
    private readonly caseFiles: CaseFilesService,
    private readonly legalDocs: LegalDocsService,
    private readonly contractsSvc: ContractsService,
    private readonly auditSvc: AuditService,
    private readonly dbs: DbService,
    private readonly telemetry: TelemetryService,
  ) {}

  @Get('monitoring/errors')
  @Roles('ops')
  monitoringErrors(@Query('days') days?: string) {
    return this.telemetry.errorGroups(Math.min(Math.max(Number(days ?? 7) || 7, 1), 90));
  }

  @Get('monitoring/analytics')
  @Roles('ops', 'finance', 'viewer')
  monitoringAnalytics(@Query('days') days?: string) {
    return this.telemetry.analytics(Math.min(Math.max(Number(days ?? 30) || 30, 1), 365));
  }

  @Get('me')
  me(@CurrentAdmin() a: AdminPrincipal): AdminMe {
    return { id: a.id, email: a.email, roles: a.roles };
  }

  @Get('overview')
  async overview(): Promise<AdminOverview> {
    const c = await this.contractsSvc.current();
    return {
      ...(await this.admin.overview()),
      ...(await this.views.overviewExtras()),
      legal: await this.legalDocs.status(c.version),
    };
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
    return this.views.circles(status);
  }

  @Get('circles/:id')
  circle(@Param('id', ParseUUIDPipe) id: string) {
    return this.views.circle(id);
  }

  @Get('members')
  @Roles('ops', 'finance', 'legal', 'viewer')
  members(
    @CurrentAdmin() a: AdminPrincipal,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    return this.views.members(a, q, status);
  }

  @Get('members/:id')
  @Roles('ops', 'finance', 'legal', 'viewer')
  member(@CurrentAdmin() a: AdminPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.member(a, id);
  }

  @Post('members/:id/ban')
  @Roles('ops')
  async ban(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    await this.admin.setBan(a, id, true, dto.reason);
    return this.views.member(a, id);
  }

  @Post('members/:id/unban')
  @Roles('ops')
  async unban(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    await this.admin.setBan(a, id, false, dto.reason);
    return this.views.member(a, id);
  }

  @Get('payments/board')
  @Roles('ops', 'finance', 'viewer')
  paymentsBoard(@CurrentAdmin() a: AdminPrincipal) {
    return this.views.paymentsBoard(a);
  }

  @Get('config')
  config() {
    return this.settings.active();
  }

  @Get('config/versions')
  configVersions() {
    return this.views.configVersions();
  }

  @Post('config/preview')
  @HttpCode(200)
  @Roles('super_admin')
  async preview(@Body() dto: ConfigDto) {
    const { config } = await this.settings.active();
    const check = validateConfig(dto.config);
    return {
      diff: diffConfig(config, dto.config),
      valid: check.ok,
      issues: check.ok ? [] : check.issues,
    };
  }

  @Post('config')
  @Roles('super_admin')
  publish(@CurrentAdmin() a: AdminPrincipal, @Body() dto: ConfigDto) {
    return this.admin.publishConfig(a, dto.config, dto.notes ?? null);
  }

  @Get('ledger/accounts')
  @Roles('finance', 'viewer')
  accounts() {
    return this.admin.ledgerAccounts();
  }

  @Get('ledger/transactions')
  @Roles('finance', 'viewer')
  transactions(
    @Query('circleId') circleId?: string,
    @Query('type') type?: string,
    @Query('account') account?: string,
  ) {
    return this.views.transactions({
      ...(circleId ? { circleId } : {}),
      ...(type ? { type } : {}),
      ...(account ? { account } : {}),
    });
  }

  @Get('finance/revenue')
  @Roles('finance', 'viewer')
  revenue() {
    return this.views.revenueReport();
  }

  /** CSV (opens in Excel) of the ledger, account balances or the revenue release report. */
  @Get('export/:dataset')
  @Roles('finance')
  @Header('Cache-Control', 'no-store')
  async export(@Param('dataset') dataset: string, @Res() res: Response): Promise<void> {
    if (!(EXPORTS as readonly string[]).includes(dataset)) throw notFound('export');
    let csv: string;
    if (dataset === 'accounts') {
      const rows = await this.admin.ledgerAccounts();
      csv = toCsv(
        ['account', 'balance_kwd', 'balance_fils'],
        rows.map((r) => [r.account, r.balance.kwd, r.balance.fils]),
      );
    } else if (dataset === 'revenue') {
      const r = await this.views.revenueReport();
      csv = toCsv(
        [
          'circle',
          'monthly_kwd',
          'members',
          'status',
          'closed_at',
          'organizing_fees',
          'bid_revenue',
          'replacement_fees',
          'recovery_fees',
          'revenue',
          'holdbacks_applied',
          'recoveries',
          'member_shortfall',
          'to_charity',
        ],
        r.rows.map((x) => [
          x.circleId,
          x.monthly.kwd,
          x.members,
          x.status,
          x.closedAt,
          x.organizingFees.kwd,
          x.bidRevenue.kwd,
          x.replacementFees.kwd,
          x.recoveryFees.kwd,
          x.revenue.kwd,
          x.holdbacksApplied.kwd,
          x.recoveries.kwd,
          x.memberShortfall.kwd,
          x.latePenaltiesToCharity.kwd,
        ]),
      );
    } else {
      const txns = await this.views.transactions({ limit: 5000 });
      csv = toCsv(
        [
          'seq',
          'created_at',
          'type',
          'key',
          'circle',
          'member',
          'month',
          'account',
          'amount_kwd',
          'amount_fils',
          'memo',
        ],
        txns.flatMap((t) =>
          t.entries.map((e) => [
            t.seq,
            t.createdAt,
            t.type,
            t.key,
            t.circleId,
            t.memberId,
            t.month,
            e.account,
            e.amount.kwd,
            e.amount.fils,
            t.memo,
          ]),
        ),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sanad-${dataset}.csv"`);
    res.send(csv);
  }

  @Get('disbursements')
  @Roles('ops', 'finance', 'viewer')
  disbursements(@Query('status') status?: string) {
    return this.admin.disbursementsList(status);
  }

  @Post('disbursements/:kind/:id/retry')
  @HttpCode(204)
  @Roles('ops', 'finance')
  async retry(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.admin.retryDisbursement(a, kind === 'refund' ? 'refund' : 'payout', id);
  }

  @Get('legal/cases')
  @Roles('legal', 'finance', 'viewer')
  legal() {
    return this.views.legalCases();
  }

  /** Case file data (identity included, so the read is audited). Phase 5 adds PDF + ZIP. */
  @Get('legal/cases/:id/file')
  @Roles('legal')
  caseFile(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ) {
    return this.views.legalCaseFile(a, id, ip);
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
  audit(
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
  ) {
    return this.views.auditLog({
      limit: Math.min(Number(limit ?? 300) || 300, 2000),
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
    });
  }

  @Get('legal/cases/:id/file.pdf')
  @Roles('legal')
  async caseFilePdf(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.caseFiles.pdfFile(a, id, ip), `sanad-case-${id.slice(0, 8)}.pdf`);
  }

  @Get('legal/cases/:id/file.zip')
  @Roles('legal')
  async caseFileZip(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ) {
    sendFile(
      res,
      await this.caseFiles.zipFile(a, id, ip),
      'application/zip',
      `sanad-case-${id.slice(0, 8)}.zip`,
    );
  }

  // ── signed documents ──

  @Get('members/:id/signatures')
  @Roles('ops', 'legal')
  memberSignatures(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractsSvc.signatures(id);
  }

  @Get('signatures/:id/pdf')
  @Roles('ops', 'legal')
  async signaturePdf(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ) {
    const f = await this.contractsSvc.signaturePdf(id);
    await this.auditSvc.log(this.dbs.db, {
      actorType: 'admin',
      actorId: a.id,
      action: 'signature.read_pdf',
      entity: 'signature',
      entityId: id,
      ip,
    });
    sendPdf(res, f.data, f.filename);
  }

  // ── legal documents: lawyer's contract + Shariah review [LEGAL][SHARIAH] ──

  @Get('legal-docs')
  @Roles('legal', 'ops', 'viewer')
  async legalDocsList() {
    const c = await this.contractsSvc.current();
    return {
      status: await this.legalDocs.status(c.version),
      documents: await this.legalDocs.list(),
    };
  }

  @Post('legal-docs')
  @Roles('legal')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LEGAL_DOC_BYTES } }))
  uploadLegalDoc(
    @CurrentAdmin() a: AdminPrincipal,
    @Body() dto: LegalDocDto,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ) {
    return this.legalDocs.upload(a, dto, file);
  }

  @Get('legal-docs/:id/file')
  @Roles('legal', 'ops', 'viewer')
  async legalDocFile(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.legalDocs.file(id);
    sendFile(res, f.data, f.contentType, f.filename);
  }

  // ── content (spec §10) ──

  @Get('content/templates')
  templates() {
    return this.content.templates();
  }

  @Put('content/templates/:key/:language')
  @Roles('ops')
  updateTemplate(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('key') key: string,
    @Param('language') language: string,
    @Body() dto: TemplateDto,
  ) {
    if (language !== 'ar' && language !== 'en') throw notFound('template');
    return this.content.updateTemplate(a, key, language, dto.title, dto.body);
  }

  @Get('content/contracts')
  @Roles('legal', 'ops', 'viewer')
  contracts() {
    return this.content.contracts();
  }

  @Post('content/contracts')
  @Roles('legal')
  publishContract(@CurrentAdmin() a: AdminPrincipal, @Body() dto: ContractDto) {
    return this.content.publishContract(a, dto);
  }

  @Get('content/faq')
  faq() {
    return this.content.faq();
  }

  @Post('content/faq')
  @Roles('ops')
  createFaq(@CurrentAdmin() a: AdminPrincipal, @Body() dto: FaqDto) {
    return this.content.saveFaq(a, null, dto);
  }

  @Put('content/faq/:id')
  @Roles('ops')
  updateFaq(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FaqDto,
  ) {
    return this.content.saveFaq(a, id, dto);
  }

  @Delete('content/faq/:id')
  @HttpCode(204)
  @Roles('ops')
  async deleteFaq(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.content.deleteFaq(a, id);
  }

  @Get('support')
  @Roles('ops', 'viewer')
  support(@Query('status') status?: string) {
    return this.views.tickets(status ? { status } : {});
  }

  @Post('support/:id')
  @HttpCode(204)
  @Roles('ops')
  async updateTicket(
    @CurrentAdmin() a: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketDto,
  ): Promise<void> {
    await this.content.updateTicket(a, id, dto.status, dto.note ?? null);
  }

  @Post('jobs/tick')
  @HttpCode(200)
  @Roles('ops')
  tick(@CurrentAdmin() a: AdminPrincipal) {
    return this.admin.runTick(a);
  }
}

/** Public content for the app (no sign-in): the FAQ shown on the support screen. */
@ApiTags('content')
@Controller('content')
export class PublicContentController {
  constructor(
    private readonly content: ContentService,
    private readonly legalDocs: LegalDocsService,
    private readonly contracts: ContractsService,
  ) {}

  @Get('faq')
  faq() {
    return this.content.faq(true);
  }

  /** Whether the contract is lawyer-approved and the Shariah review status [LEGAL][SHARIAH]. */
  @Get('legal-status')
  async legalStatus() {
    return this.legalDocs.status((await this.contracts.current()).version);
  }

  /** Download an approved Shariah review (other legal documents are staff-only). */
  @Get('legal-docs/:id/file')
  async legalDoc(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.legalDocs.file(id, true);
    sendFile(res, f.data, f.contentType, f.filename);
  }
}
