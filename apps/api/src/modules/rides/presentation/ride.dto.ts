import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CoordinateDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class CreateRideDto {
  @IsUUID() vehicleId!: string;
  @IsOptional() @IsUUID() favoriteRouteId?: string;
  @ValidateNested() @Type(() => CoordinateDto) origin!: CoordinateDto;
  @ValidateNested() @Type(() => CoordinateDto) destination!: CoordinateDto;
  @IsOptional() @IsString() originAddress?: string;
  @IsOptional() @IsString() destinationAddress?: string;
  @IsOptional() @IsString() routePolyline?: string;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  transportStopIds!: string[];
  @IsDateString() departureTime!: string;
  @IsInt() @Min(1) @Max(20) availableSeats!: number;
  @IsInt() @Min(1) pricePerSeatCents!: number;
}

export class SearchRidesDto {
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin!: CoordinateDto;
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination!: CoordinateDto;
  @IsOptional() @IsDateString() fromTime?: string;
  @IsOptional() @IsDateString() toTime?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxResults = 50;
  @IsOptional() @IsNumber() @Min(0.1) @Max(100) maxDistanceKm = 8;
  @IsOptional() @IsInt() @Min(1) @Max(5000) maxDistanceMeters = 500;
}

export class UpdateRideDto extends CreateRideDto {
  @IsInt() @Min(1) version!: number;
}

export class RideStopOptionsDto {
  @ValidateNested() @Type(() => CoordinateDto) origin!: CoordinateDto;
  @ValidateNested() @Type(() => CoordinateDto) destination!: CoordinateDto;
  @IsOptional() @IsInt() @Min(1) @Max(5000) maxDistanceMeters = 500;
}

export class RideReasonDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class RecentRidesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 5;
}

export class DriverRidesQueryDto {
  @IsOptional()
  @IsIn(['scheduled', 'full', 'in_progress', 'completed', 'cancelled'])
  status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}
