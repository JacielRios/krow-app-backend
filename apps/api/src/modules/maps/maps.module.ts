import { Module } from '@nestjs/common';
import { GoogleMapsService } from './infrastructure/google-maps.service.js';
import { MapsController } from './presentation/maps.controller.js';
import { MapsRateLimitGuard } from './presentation/maps-rate-limit.guard.js';

@Module({
  controllers: [MapsController],
  providers: [GoogleMapsService, MapsRateLimitGuard],
  exports: [GoogleMapsService, MapsRateLimitGuard],
})
export class MapsModule {}
