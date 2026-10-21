import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsUrl,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpsertProfileDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  fullName!: string;
  @Transform(trimmed) @IsString() @MaxLength(50) institutionalId!: string;
  @Transform(trimmed) @IsString() @MaxLength(150) academicProgram!: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) academicPeriod?: number | null;
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  profilePhoto?: string | null;
}
