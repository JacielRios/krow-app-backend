import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RuntimeDatabase } from './infrastructure/runtime-database.js';
import { RuntimeStreams } from './infrastructure/runtime-streams.js';
import { MapboxRouting } from './infrastructure/mapbox-routing.js';
import { RuntimeService } from './application/runtime.service.js';
import { TrackingService } from './application/tracking.service.js';
import { RuntimeWorker } from './application/runtime.worker.js';
import { RuntimeController } from './presentation/runtime.controller.js';
import { RuntimeGateway } from './presentation/runtime.gateway.js';
import { NotificationProviders } from './infrastructure/notification-providers.js';
import { NotificationsService } from './application/notifications.service.js';
import { NotificationsController } from './presentation/notifications.controller.js';
import { GeospatialWorker } from './application/geospatial.worker.js';

@Module({
  imports: [AuthModule],
  controllers: [RuntimeController, NotificationsController],
  providers: [
    RuntimeDatabase,
    RuntimeStreams,
    MapboxRouting,
    RuntimeService,
    TrackingService,
    RuntimeWorker,
    RuntimeGateway,
    NotificationProviders,
    NotificationsService,
    GeospatialWorker,
  ],
})
export class RideRuntimeModule {}
