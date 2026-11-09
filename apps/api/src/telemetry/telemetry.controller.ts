import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TelemetryService } from './telemetry.service.js';

class ClientErrorDto {
  @ApiProperty({ enum: ['mobile', 'admin'] }) @IsIn(['mobile', 'admin']) source!:
    'mobile' | 'admin';
  @ApiProperty() @IsString() @Length(1, 2000) message!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 8000) stack?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) context?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 20) platform?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 20) appVersion?: string;
}

class EventDto {
  @ApiProperty() @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(50) n?: number;
}

class EventsDto {
  @ApiProperty({ type: [EventDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EventDto)
  events!: EventDto[];
  @ApiProperty() @IsString() @Length(1, 20) platform!: string;
  @ApiProperty() @IsString() @Length(1, 20) appVersion!: string;
}

/**
 * Public, unauthenticated on purpose: crashes can happen before sign-in, and analytics are
 * anonymous (no user, device or IP is stored). Both are rate limited.
 */
@ApiTags('telemetry')
@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post('errors')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async error(@Body() dto: ClientErrorDto): Promise<void> {
    await this.telemetry.recordError(dto);
  }

  @Post('events')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  events(@Body() dto: EventsDto) {
    return this.telemetry.track(dto.events, dto.platform, dto.appVersion);
  }
}
