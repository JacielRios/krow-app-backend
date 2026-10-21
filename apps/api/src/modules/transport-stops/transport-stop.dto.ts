import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsInt,
  IsUUID,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SaveTransportStopDto {
  @IsString() @MinLength(1) @MaxLength(120) externalId!: string;
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(160) municipality?: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsIn(['general', 'official_boarding_zone'])
  stopType!: 'general' | 'official_boarding_zone';
  @IsBoolean() active!: boolean;
  @IsOptional() @IsUUID() corridorId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(10000) stopOrder?: number | null;
  @IsOptional() @IsString() @MaxLength(160) direction?: string | null;
}
