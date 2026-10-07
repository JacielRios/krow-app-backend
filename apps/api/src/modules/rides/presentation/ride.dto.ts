import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CAMPUS_ORIGIN } from '../../routes/domain/campus-origin.js';

export class CoordinateDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class CreateRideDto {
  @IsUUID() vehicleId!: string;
  @IsOptional() @IsUUID() favoriteRouteId?: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin: CoordinateDto = Object.assign(new CoordinateDto(), {
    lat: CAMPUS_ORIGIN.lat,
    lng: CAMPUS_ORIGIN.lng,
  });
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination!: CoordinateDto;
  @IsOptional() @IsString() originAddress?: string;
  @IsOptional() @IsString() destinationAddress?: string;
  @IsOptional() @IsString() routePolyline?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  transportStopIds?: string[];
  @IsDateString() departureTime!: string;
  @IsInt() @Min(1) @Max(20) availableSeats!: number;
  // A reservation of up to twenty seats must still fit the committed int cents.
  @IsInt()
  @Min(1)
  @Max(Math.floor(2_147_483_647 / 20))
  pricePerSeatCents!: number;
}

export class SearchRidesDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin: CoordinateDto = Object.assign(new CoordinateDto(), {
    lat: CAMPUS_ORIGIN.lat,
    lng: CAMPUS_ORIGIN.lng,
  });
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination!: CoordinateDto;
  @IsOptional() @IsDateString() fromTime?: string;
  @IsOptional() @IsDateString() toTime?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxResults = 50;
  @IsOptional() @IsNumber() @Min(0.1) @Max(100) maxDistanceKm = 8;
  @IsOptional() @IsInt() @Min(1) @Max(5000) maxDistanceMeters = 1000;
  @IsOptional() @IsUUID() pickupTransportStopId?: string;
  @IsOptional() @IsUUID() dropoffTransportStopId?: string;
}

export class UpdateRideDto extends CreateRideDto {
  @IsInt() @Min(1) version!: number;
}

export class RideStopOptionsDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin!: CoordinateDto;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination!: CoordinateDto;
  @IsOptional() @IsInt() @Min(1) @Max(5000) maxDistanceMeters = 1000;
}

export class PassengerStopCandidatesDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin: CoordinateDto = Object.assign(new CoordinateDto(), {
    lat: CAMPUS_ORIGIN.lat,
    lng: CAMPUS_ORIGIN.lng,
  });
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination!: CoordinateDto;
  @IsOptional() @IsInt() @Min(1) @Max(5000) maxDistanceMeters = 1000;
  @IsOptional() @IsIn(['campus', 'route']) pickupScope: 'campus' | 'route' =
    'campus';
}

export class RideReasonDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class RecentRidesQueryDto {
  @IsOptional() @IsIn(['driver', 'passenger']) context?: 'driver' | 'passenger';
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 5;
}

export class DriverRidesQueryDto {
  @IsOptional() @IsIn(['upcoming', 'active', 'history']) group?:
    | 'upcoming'
    | 'active'
    | 'history';
  @IsOptional()
  @IsIn(['scheduled', 'full', 'in_progress', 'completed', 'cancelled'])
  status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}
