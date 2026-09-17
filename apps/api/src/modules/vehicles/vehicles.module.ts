import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';

@Module({ controllers: [VehiclesController], providers: [VehiclesService] })
export class VehiclesModule {}
