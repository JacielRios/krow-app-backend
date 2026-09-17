import { Module } from '@nestjs/common';
import { BookingsService } from './application/bookings.service.js';
import { BookingsController } from './presentation/bookings.controller.js';

@Module({ controllers: [BookingsController], providers: [BookingsService] })
export class BookingsModule {}
