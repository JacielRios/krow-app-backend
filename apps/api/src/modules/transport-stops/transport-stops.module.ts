import { Module } from '@nestjs/common';
import { TransportStopsController } from './transport-stops.controller.js';
import { TransportStopsService } from './transport-stops.service.js';

@Module({
  controllers: [TransportStopsController],
  providers: [TransportStopsService],
})
export class TransportStopsModule {}
