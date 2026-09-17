import { Type } from 'class-transformer';
import {
  IsDateString,
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
  @ValidateNested() @Type(() => CoordinateDto) origin!: CoordinateDto;
  @ValidateNested() @Type(() => CoordinateDto) destination!: CoordinateDto;
  @IsOptional() @IsString() originAddress?: string;
  @IsOptional() @IsString() destinationAddress?: string;
  @IsOptional() @IsString() routePolyline?: string;
  @IsDateString() departureTime!: string;
  @IsInt() @Min(1) @Max(20) availableSeats!: number;
  @IsInt() @Min(0) pricePerSeatCents!: number;
}

export class SearchRidesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  origin?: CoordinateDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  destination?: CoordinateDto;
  @IsOptional() @IsDateString() fromTime?: string;
  @IsOptional() @IsDateString() toTime?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxResults = 50;
  @IsOptional() @IsNumber() @Min(0.1) @Max(100) maxDistanceKm = 8;
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
