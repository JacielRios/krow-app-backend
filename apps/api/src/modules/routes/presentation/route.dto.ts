import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CoordinateDto } from '../../rides/presentation/ride.dto.js';

export class RouteEndpointDto extends CoordinateDto {
  @IsString() @MinLength(1) @MaxLength(500) address!: string;
  @IsOptional() @IsString() @MaxLength(250) placeId?: string;
}

export class RoutePreviewRequestDto {
  @ValidateNested() @Type(() => CoordinateDto) origin!: CoordinateDto;
  @ValidateNested() @Type(() => CoordinateDto) destination!: CoordinateDto;
  @IsOptional() @IsDateString() departureTime?: string;
}

export class SaveFavoriteRouteDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @ValidateNested() @Type(() => RouteEndpointDto) origin!: RouteEndpointDto;
  @ValidateNested()
  @Type(() => RouteEndpointDto)
  destination!: RouteEndpointDto;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  transportStopIds?: string[];
  @IsOptional() @IsUUID() defaultVehicleId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) defaultAvailableSeats?: number;
  @IsOptional() @IsInt() @Min(1) defaultPricePerSeatCents?: number;
}
