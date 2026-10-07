import { Global, Module } from '@nestjs/common';
import { MapsModule } from '../maps/maps.module.js';
import { PilotDatabase } from './pilot.database.js';
import { PilotService } from './pilot.service.js';
import { PilotController, PilotUploadController } from './pilot.controller.js';
import { PilotGateway } from './pilot.gateway.js';
import { PilotNotifications } from './pilot.notifications.js';
import { PilotRateLimitGuard } from './pilot-rate-limit.guard.js';
import { NotificationProviders } from '../ride-runtime/infrastructure/notification-providers.js';
@Global()
@Module({
  imports: [MapsModule],
  providers: [
    PilotDatabase,
    PilotService,
    PilotGateway,
    PilotNotifications,
    PilotRateLimitGuard,
    NotificationProviders,
  ],
  controllers: [PilotController, PilotUploadController],
  exports: [PilotDatabase, PilotService],
})
export class PilotModule {}
