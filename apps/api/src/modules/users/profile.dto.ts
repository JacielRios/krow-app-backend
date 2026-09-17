import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertProfileDto {
  @IsString() @MaxLength(150) fullName!: string;
  @IsString() @MaxLength(50) institutionalId!: string;
  @IsString() @MaxLength(150) academicProgram!: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) academicPeriod?: number | null;
}
