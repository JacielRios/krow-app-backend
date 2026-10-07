import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { RuntimeAction } from '../domain/protocol.js';

export class RuntimeCommandDto {
  @IsUUID() commandId!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn([
    'start',
    'complete',
    'interrupt',
    'cancel',
    'arrive',
    'depart',
    'board',
    'dropoff',
    'no_show',
    'accept_booking',
    'reject_booking',
    'cancel_booking',
  ])
  action!: RuntimeAction;
  @IsOptional() @IsUUID() stopId?: string;
  @IsOptional() @IsUUID() bookingId?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class RuntimeBookingDto {
  @IsUUID() commandId!: string;
  @IsUUID() pickupStopId!: string;
  @IsUUID() dropoffStopId!: string;
  @IsInt() @Min(1) @Max(50) seats!: number;
}
export class LocationSampleDto {
  @IsUUID() sessionId!: string;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) sequence!: number;
  @IsISO8601({ strict: true }) capturedAt!: string;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;
  @IsNumber() @Min(0.01) @Max(5000) accuracyMeters!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(80) speedMps: number | null = null;
  @IsOptional() @IsNumber() @Min(0) @Max(359.999) headingDegrees:
    | number
    | null = null;
}
export class LocationBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LocationSampleDto)
  samples!: LocationSampleDto[];
}
export class LocationSessionDto {
  @IsUUID() deviceId!: string;
}
export class RouteUpdateDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['initial', 'traffic', 'closure', 'deviation', 'reconciliation'])
  reason!: 'initial' | 'traffic' | 'closure' | 'deviation' | 'reconciliation';
}
export class ReplayDto {
  @Type(() => Number) @IsInt() @Min(0) after = 0;
}
export class DeviceDto {
  @IsUUID() deviceId!: string;
  @IsIn(['android', 'ios']) platform!: 'android' | 'ios';
  @IsString() @MaxLength(4096) token!: string;
}
export class IncidentDto {
  @IsUUID() incidentId!: string;
  @IsIn(['urgent', 'critical']) severity!: 'urgent' | 'critical';
}
export class IncidentActionDto {
  @IsIn(['acknowledged', 'responding', 'resolved']) state!:
    | 'acknowledged'
    | 'responding'
    | 'resolved';
}
