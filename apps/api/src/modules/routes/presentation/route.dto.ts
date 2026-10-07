import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CoordinateDto } from '../../rides/presentation/ride.dto.js';
import { CAMPUS_ORIGIN } from '../domain/campus-origin.js';

export class RouteEndpointDto extends CoordinateDto {
  @IsString() @MinLength(1) @MaxLength(500) address!: string;
  @IsOptional() @IsString() @MaxLength(250) placeId?: string;
}

export class RoutePreviewRequestDto {
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
  @IsOptional() @IsDateString() departureTime?: string;
}

export class SaveFavoriteRouteDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RouteEndpointDto)
  origin: RouteEndpointDto = Object.assign(
    new RouteEndpointDto(),
    CAMPUS_ORIGIN,
  );
  @IsDefined()
  @IsObject()
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
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Math.floor(2_147_483_647 / 20))
  defaultPricePerSeatCents?: number;
}
