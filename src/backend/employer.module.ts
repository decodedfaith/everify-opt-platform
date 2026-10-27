/**
 * ============================================================================
 * E-Verify Platform - Employer Module (NestJS)
 * ============================================================================
 * NestJS Dependency Injection module wiring Controller, Service, and Repository.
 * ============================================================================
 */

import { Module } from '@nestjs/common';
import { EmployerController } from './controllers/employer.controller';
import { EmployerService } from './services/employer.service';
import { EmployerRepository } from './repositories/employer.repository';

@Module({
  controllers: [EmployerController],
  providers: [EmployerService, EmployerRepository],
  exports: [EmployerService, EmployerRepository],
})
export class EmployerModule {}
