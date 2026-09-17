import { Module } from '@nestjs/common';
import { RidesService } from './application/rides.service.js';
import { RidesController } from './presentation/rides.controller.js';
import { MatchingModule } from '../matching/matching.module.js';
import { RideViewsService } from './application/ride-views.service.js';

@Module({
  imports: [MatchingModule],
  controllers: [RidesController],
  providers: [RidesService, RideViewsService],
  exports: [RidesService],
})
export class RidesModule {}
