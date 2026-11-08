import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentMember, MemberGuard, type MemberPrincipal } from '../auth/guards.js';
import { ENV, type Env } from '../config/env.js';
import { money } from '../common/money.js';
import { PDF_GENERATOR, type PdfGenerator } from '../providers/storage.provider.js';
import { PaymentsService } from './payments.service.js';

class IntentDto {
  @ApiProperty({ enum: ['CONTRIBUTION', 'REPLACEMENT'] })
  @IsIn(['CONTRIBUTION', 'REPLACEMENT'])
  purpose!: 'CONTRIBUTION' | 'REPLACEMENT';

  @ApiProperty() @IsUUID() circleId!: string;

  @ApiPropertyOptional({ description: 'Required for CONTRIBUTION' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  month?: number;

  @ApiPropertyOptional({ description: 'Required for REPLACEMENT' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  spot?: number;
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(ENV) private readonly env: Env,
    @Inject(PDF_GENERATOR) private readonly pdf: PdfGenerator,
  ) {}

  /** Pay a monthly contribution (now or in advance) or take over a vacated spot. */
  @Post('intents')
  @ApiBearerAuth()
  @UseGuards(MemberGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  intent(
    @CurrentMember() m: MemberPrincipal,
    @Body() dto: IntentDto,
    @Headers('idempotency-key') key = '',
  ) {
    const input =
      dto.purpose === 'CONTRIBUTION'
        ? { purpose: 'CONTRIBUTION' as const, circleId: dto.circleId, month: dto.month ?? 0 }
        : { purpose: 'REPLACEMENT' as const, circleId: dto.circleId, spot: dto.spot ?? 0 };
    return this.payments.createIntent(m.id, input, key);
  }

  /** Payment-gateway webhook (HMAC-SHA256 signature in `x-sanad-signature`). */
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-sanad-signature') signature?: string) {
    return this.payments.handleWebhook(req.rawBody?.toString('utf8') ?? '', signature);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(MemberGuard)
  list(@CurrentMember() m: MemberPrincipal) {
    return this.payments.list(m.id);
  }

  @Get(':id/receipt')
  @ApiBearerAuth()
  @UseGuards(MemberGuard)
  async receipt(
    @CurrentMember() m: MemberPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const p = await this.payments.get(m.id, id);
    const pdf = await this.pdf.render('receipt', {
      id: p.id,
      amount: money(p.amountFils).kwd,
      status: p.status,
      date: p.succeededAt?.toISOString() ?? '',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sanad-receipt-${p.id}.pdf"`);
    res.send(pdf);
  }

  /** DEV ONLY: confirm a mock payment as if the member paid at the gateway. */
  @Post('dev/:id/confirm')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(MemberGuard)
  async devConfirm(@CurrentMember() m: MemberPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    if (!this.env.DEV_ENDPOINTS) throw new ForbiddenException('dev endpoints are disabled');
    await this.payments.get(m.id, id);
    return this.payments.devConfirm(id);
  }
}
