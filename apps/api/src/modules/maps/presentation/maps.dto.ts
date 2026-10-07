import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CoordinateDto } from '../../rides/presentation/ride.dto.js';

export class AutocompleteQueryDto {
  @IsString() @MinLength(2) @MaxLength(200) query!: string;
  @IsOptional() @IsString() sessionToken?: string;
}

export class PlaceDetailsQueryDto {
  @IsOptional() @IsString() sessionToken?: string;
}

export class ReverseGeocodeDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CoordinateDto)
  point!: CoordinateDto;
}

export class RoutePreviewDto {
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
  @IsOptional() @IsDateString() departureTime?: string;
}
