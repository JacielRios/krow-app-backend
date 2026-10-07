import { Type, Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ADMIN_STATUSES = ['active', 'suspended', 'inactive'] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];
export const DOCUMENT_KINDS = [
  'license',
  'identity',
  'registration',
  'insurance',
  'other',
] as const;
export const DOCUMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AdminListDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class AdminDriverListDto extends AdminListDto {
  @IsOptional() @IsIn(ADMIN_STATUSES) status?: AdminStatus;
}
export class AdminVehicleListDto extends AdminDriverListDto {
  @IsOptional() @IsUUID() driverId?: string;
}
export class CreateAdminDriverDto {
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254) email?: string;
  @Transform(trim) @IsString() @Length(1, 80) licenseNumber!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  licenseExpiresAt!: string;
  @IsOptional() @IsIn(ADMIN_STATUSES) status: AdminStatus = 'inactive';
}
export class UpdateAdminDriverDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 160) fullName?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  licenseNumber?: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  licenseExpiresAt?: string;
}
export class AdminStatusDto {
  @IsIn(ADMIN_STATUSES) status!: AdminStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string;
}
export class CreateAdminVehicleDto {
  @IsUUID() driverId!: string;
  @Transform(trim) @IsString() @Length(1, 20) plate!: string;
  @Transform(trim) @IsString() @Length(1, 80) brand!: string;
  @Transform(trim) @IsString() @Length(1, 80) model!: string;
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(new Date().getFullYear() + 1)
  year!: number;
  @Transform(trim) @IsString() @Length(1, 40) color!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(16) capacity!: number;
  @IsOptional() @IsIn(ADMIN_STATUSES) status: AdminStatus = 'inactive';
}
export class UpdateAdminVehicleDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 20) plate?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) brand?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) model?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(new Date().getFullYear() + 1)
  year?: number;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 40) color?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(16) capacity?: number;
  @IsOptional() @IsIn(ADMIN_STATUSES) status?: AdminStatus;
}
export class AdminDocumentListDto extends AdminListDto {
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsIn(DOCUMENT_STATUSES) status?: string;
  @IsOptional()
  @IsIn(['all', 'expired', 'valid', 'no_expiry'])
  validity?: string;
}
export class CreateAdminDocumentDto {
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsIn(DOCUMENT_KINDS) kind!: string;
  @Transform(trim) @IsString() @Length(1, 180) fileName!: string;
  @IsIn(['application/pdf', 'image/jpeg', 'image/png']) contentType!: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  sizeBytes!: number;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  expiresAt?: string;
}
export class UpdateAdminDocumentDto {
  @IsOptional() @IsIn(DOCUMENT_STATUSES) status?: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  expiresAt?: string | null;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  reviewNotes?: string;
}
export class AdminRideListDto extends AdminListDto {
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional()
  @IsIn(['scheduled', 'full', 'in_progress', 'completed', 'cancelled'])
  status?: string;
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @IsOptional() @IsDateString({ strict: true }) to?: string;
}
export class AdminAuditListDto extends AdminListDto {
  @IsOptional() @IsIn(['driver', 'vehicle', 'document']) entityType?: string;
  @IsOptional() @IsUUID() entityId?: string;
}
