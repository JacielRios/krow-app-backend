import { Module } from '@nestjs/common';
import { MapsModule } from '../maps/maps.module.js';
import { RoutesService } from './application/routes.service.js';
import { RoutesController } from './presentation/routes.controller.js';

@Module({
  imports: [MapsModule],
  controllers: [RoutesController],
  providers: [RoutesService],
  exports: [RoutesService],
})
export class RoutesModule {}
