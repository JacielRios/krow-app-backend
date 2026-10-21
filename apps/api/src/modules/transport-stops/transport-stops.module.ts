import { Module } from '@nestjs/common';
import { TransportStopsController } from './transport-stops.controller.js';
import { TransportStopsService } from './transport-stops.service.js';
import { MapsModule } from '../maps/maps.module.js';
import { StopSuggestionsService } from './stop-suggestions.service.js';

@Module({
  imports: [MapsModule],
  controllers: [TransportStopsController],
  providers: [TransportStopsService, StopSuggestionsService],
})
export class TransportStopsModule {}
