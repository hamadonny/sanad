import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  get(): HealthStatus {
    return this.health.check();
  }
}
