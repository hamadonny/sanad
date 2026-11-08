import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuthService } from './auth.service.js';
import { TokensService } from './tokens.service.js';

class OtpRequestDto {
  @ApiProperty({ example: '+96550000001' })
  @IsString()
  @Length(8, 20)
  phone!: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'] })
  @IsOptional()
  @IsIn(['ar', 'en'])
  language?: 'ar' | 'en';
}

class OtpVerifyDto {
  @ApiProperty({ example: '+96550000001' })
  @IsString()
  @Length(8, 20)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/)
  code!: string;
}

class RefreshDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  refreshToken!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  @Post('otp/request')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  request(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto.phone, dto.language);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.tokens.rotate('member', dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.tokens.revokeFamilyOf(dto.refreshToken);
  }
}
