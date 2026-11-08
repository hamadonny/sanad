import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { kwd } from '@sanad/core';
import { CurrentMember, MemberGuard, type MemberPrincipal } from '../auth/guards.js';
import { DisbursementService } from '../payments/disbursement.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CirclesService } from './circles.service.js';

class JoinQueueDto {
  @ApiProperty({ example: 100, description: 'Monthly amount in whole KWD' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  monthlyKwd!: number;
}

class BidDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(24) spot!: number;
  @ApiProperty({ example: '45000', description: 'Bid in fils' })
  @IsString()
  @Matches(/^\d{1,12}$/)
  amountFils!: string;
}

@ApiTags('circles')
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller('circles')
export class CirclesController {
  constructor(
    private readonly circles: CirclesService,
    private readonly payments: PaymentsService,
    private readonly disbursements: DisbursementService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('options')
  options(@CurrentMember() m: MemberPrincipal) {
    return this.circles.options(m.id);
  }

  /** Join the queue: creates the entry-fee payment; the seat is taken when the payment succeeds. */
  @Post('queue')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  join(
    @CurrentMember() m: MemberPrincipal,
    @Body() dto: JoinQueueDto,
    @Headers('idempotency-key') key = '',
  ) {
    return this.payments.createIntent(
      m.id,
      { purpose: 'ENTRY_FEE', monthlyFils: kwd(dto.monthlyKwd) },
      key,
    );
  }

  /** Leave during FORMING: full entry-fee refund. */
  @Delete('queue/:id')
  @HttpCode(204)
  async leave(
    @CurrentMember() m: MemberPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.circles.leave(m.id, id);
    await this.disbursements.flush();
  }

  @Get()
  list(@CurrentMember() m: MemberPrincipal) {
    return this.circles.listMine(m.id);
  }

  @Get('replacements')
  replacements(@CurrentMember() m: MemberPrincipal) {
    return this.circles.replacements(m.id);
  }

  @Get(':id')
  detail(@CurrentMember() m: MemberPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.circles.detail(m.id, id);
  }

  @Get(':id/auction')
  auction(@CurrentMember() m: MemberPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.circles.auctionView(m.id, id);
  }

  @Post(':id/auction/bids')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async bid(
    @CurrentMember() m: MemberPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BidDto,
  ) {
    const view = await this.circles.placeBid(m.id, id, dto.spot, BigInt(dto.amountFils));
    await this.notifications.dispatchPending();
    return view;
  }

  @Get(':id/draw')
  draw(@CurrentMember() m: MemberPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.circles.drawView(m.id, id);
  }

  @Get(':id/schedule')
  schedule(@CurrentMember() m: MemberPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.circles.schedule(m.id, id);
  }
}
