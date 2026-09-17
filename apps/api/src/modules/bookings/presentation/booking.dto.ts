import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RequestBookingDto {
  @IsOptional() @IsInt() @Min(1) @Max(20) seats = 1;
}

export class BookingStatusReasonDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
