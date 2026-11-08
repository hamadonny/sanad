import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { and, desc, eq } from 'drizzle-orm';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClientIp, CurrentMember, MemberGuard, type MemberPrincipal } from '../auth/guards.js';
import { notFound, unprocessable } from '../common/errors.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { DbService } from '../db/db.service.js';
import { devices, notifications, supportTickets } from '../db/schema.js';
import { KycService } from '../kyc/kyc.service.js';
import { MembersService } from './members.service.js';

class UpdateMeDto {
  @ApiProperty({ enum: ['ar', 'en'] })
  @IsIn(['ar', 'en'])
  language!: 'ar' | 'en';
}

class KycSubmissionDto {
  @ApiProperty() @IsString() @Length(2, 120) fullNameAr!: string;
  @ApiProperty() @IsString() @Length(2, 120) fullNameEn!: string;
  @ApiProperty({ example: '290010112345' }) @Matches(/^\d{12}$/) civilIdNumber!: string;
  @ApiProperty({ example: 'KW' }) @IsString() @Length(2, 3) nationality!: string;
  @ApiProperty({ example: '1990-01-01' }) @IsDateString({ strict: true }) dateOfBirth!: string;
  @ApiProperty({ example: '2030-01-01' }) @IsDateString({ strict: true }) civilIdExpiry!: string;
  @ApiProperty() @IsString() @Length(3, 300) address!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) employer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 40) incomeBand?: string;
}

class SignContractDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}

class DeviceDto {
  @ApiProperty() @IsString() @Length(10, 300) pushToken!: string;
  @ApiProperty({ enum: ['ios', 'android'] }) @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
}

class TicketDto {
  @ApiProperty() @IsString() @Length(3, 140) subject!: string;
  @ApiProperty() @IsString() @Length(3, 4000) body!: string;
}

const MAX_DOC_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller()
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly kyc: KycService,
    private readonly contracts: ContractsService,
    private readonly dbs: DbService,
  ) {}

  @Get('me')
  me(@CurrentMember() m: MemberPrincipal) {
    return this.members.me(m.id);
  }

  @Patch('me')
  update(@CurrentMember() m: MemberPrincipal, @Body() dto: UpdateMeDto) {
    return this.members.updateLanguage(m.id, dto.language);
  }

  @Delete('me')
  @HttpCode(204)
  async remove(@CurrentMember() m: MemberPrincipal): Promise<void> {
    await this.members.deleteAccount(m.id);
  }

  @Post('kyc/submissions')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'back', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_DOC_BYTES } },
    ),
  )
  submitKyc(
    @CurrentMember() m: MemberPrincipal,
    @Body() dto: KycSubmissionDto,
    @UploadedFiles()
    files: Partial<
      Record<'front' | 'back' | 'selfie', { buffer: Buffer; mimetype: string }[]>
    > = {},
  ) {
    const pick = (k: 'front' | 'back' | 'selfie') => {
      const f = files[k]?.[0];
      if (f && !IMAGE_TYPES.includes(f.mimetype))
        throw unprocessable('INVALID_FILE', `${k} must be an image`);
      return f;
    };
    return this.kyc.submit(m.id, dto, {
      front: pick('front'),
      back: pick('back'),
      selfie: pick('selfie'),
    });
  }

  @Get('kyc/status')
  kycStatus(@CurrentMember() m: MemberPrincipal) {
    return this.kyc.status(m.id);
  }

  @Get('contracts/current')
  async currentContract(@CurrentMember() m: MemberPrincipal) {
    const c = await this.contracts.current();
    return {
      version: c.version,
      titleAr: c.titleAr,
      titleEn: c.titleEn,
      bodyAr: c.bodyAr,
      bodyEn: c.bodyEn,
      sha256: c.sha256,
      signed: await this.contracts.hasSignedCurrent(m.id),
    };
  }

  @Post('contracts/sign')
  @HttpCode(200)
  sign(
    @CurrentMember() m: MemberPrincipal,
    @Body() dto: SignContractDto,
    @ClientIp() ip: string | null,
    @Headers('user-agent') ua?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.contracts.sign(m.id, dto.version, {
      ip,
      userAgent: ua ?? null,
      deviceId: deviceId ?? null,
    });
  }

  @Post('devices')
  @HttpCode(204)
  async device(@CurrentMember() m: MemberPrincipal, @Body() dto: DeviceDto): Promise<void> {
    await this.dbs.db
      .insert(devices)
      .values({ userId: m.id, pushToken: dto.pushToken, platform: dto.platform })
      .onConflictDoUpdate({
        target: devices.pushToken,
        set: { userId: m.id, platform: dto.platform },
      });
  }

  @Get('notifications')
  async list(@CurrentMember() m: MemberPrincipal) {
    const rows = await this.dbs.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, m.id))
      .orderBy(desc(notifications.createdAt))
      .limit(100);
    return rows.map((n) => ({
      id: n.id,
      eventKey: n.eventKey,
      title: n.title,
      body: n.body,
      data: n.data,
      createdAt: n.createdAt,
      readAt: n.readAt,
    }));
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async read(
    @CurrentMember() m: MemberPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const r = await this.dbs.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, m.id)))
      .returning({ id: notifications.id });
    if (r.length === 0) throw notFound('notification');
  }

  @Post('support/tickets')
  async ticket(@CurrentMember() m: MemberPrincipal, @Body() dto: TicketDto) {
    const [t] = await this.dbs.db
      .insert(supportTickets)
      .values({ userId: m.id, subject: dto.subject, body: dto.body })
      .returning();
    return { id: t!.id, status: t!.status };
  }
}
