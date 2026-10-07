import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { validateEnvironment } from './shared/config/environment.js';
import { SupabaseModule } from './infrastructure/supabase/supabase.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { VehiclesModule } from './modules/vehicles/vehicles.module.js';
import { RidesModule } from './modules/rides/rides.module.js';
import { BookingsModule } from './modules/bookings/bookings.module.js';
import { MapsModule } from './modules/maps/maps.module.js';
import { RoutesModule } from './modules/routes/routes.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { TransportStopsModule } from './modules/transport-stops/transport-stops.module.js';
import { RideRuntimeModule } from './modules/ride-runtime/ride-runtime.module.js';
import { PilotModule } from './modules/pilot/pilot.module.js';
import { AdminModule } from './modules/admin/admin.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    SupabaseModule,
    AuthModule,
    UsersModule,
    VehiclesModule,
    RidesModule,
    BookingsModule,
    MapsModule,
    RoutesModule,
    ReportsModule,
    TransportStopsModule,
    RideRuntimeModule,
    PilotModule,
    AdminModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
