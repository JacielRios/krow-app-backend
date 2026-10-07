import { BadRequestException, ValidationPipe, type Type } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateRideDto,
  SearchRidesDto,
  RideStopOptionsDto,
  PassengerStopCandidatesDto,
} from './ride.dto.js';
import {
  RoutePreviewRequestDto,
  SaveFavoriteRouteDto,
} from '../../routes/presentation/route.dto.js';
import {
  RoutePreviewDto,
  ReverseGeocodeDto,
} from '../../maps/presentation/maps.dto.js';

describe('required route coordinate HTTP validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const point = { lat: 25.67, lng: -100.3 };
  const cases: Array<{
    dto: Type<unknown>;
    payload: Record<string, unknown>;
    field: string;
  }> = [
    {
      dto: CreateRideDto,
      payload: {
        vehicleId: randomUUID(),
        origin: point,
        destination: point,
        departureTime: new Date(Date.now() + 3_600_000).toISOString(),
        availableSeats: 1,
        pricePerSeatCents: 1250,
      },
      field: 'destination',
    },
    ...[
      SearchRidesDto,
      RideStopOptionsDto,
      PassengerStopCandidatesDto,
      RoutePreviewRequestDto,
      RoutePreviewDto,
    ].map((dto) => ({
      dto,
      payload: { origin: point, destination: point },
      field: 'destination',
    })),
    { dto: ReverseGeocodeDto, payload: { point }, field: 'point' },
    {
      dto: SaveFavoriteRouteDto,
      payload: {
        name: 'Campus',
        origin: { ...point, address: 'Campus' },
        destination: { ...point, address: 'Destino' },
      },
      field: 'destination',
    },
  ];
  it.each(cases)(
    'rejects missing/null/array coordinates in $dto.name before calling services',
    async ({ dto, payload, field }) => {
      await expect(
        pipe.transform(payload, { type: 'body', metatype: dto }),
      ).resolves.toBeInstanceOf(dto);
      for (const invalid of [undefined, null, [], [point], {}, '25,-100'])
        await expect(
          pipe.transform(
            { ...payload, [field]: invalid },
            { type: 'body', metatype: dto },
          ),
        ).rejects.toThrow(BadRequestException);
    },
  );
  it.each([
    CreateRideDto,
    SearchRidesDto,
    PassengerStopCandidatesDto,
    RoutePreviewRequestDto,
    SaveFavoriteRouteDto,
  ])(
    'defaults an omitted origin to the Instituto and rejects an invalid origin in %p',
    async (dto) => {
      const entry = cases.find((test) => test.dto === dto)!;
      const { origin: omitted, ...payload } = entry.payload;
      void omitted;
      const value: unknown = await pipe.transform(payload, {
        type: 'body',
        metatype: dto,
      });
      expect((value as { origin: unknown }).origin).toMatchObject({
        lat: 25.664011,
        lng: -100.243225,
      });
      for (const invalid of [null, [], {}, 'invalid']) {
        await expect(
          pipe.transform(
            { ...payload, origin: invalid },
            { type: 'body', metatype: dto },
          ),
        ).rejects.toThrow(BadRequestException);
      }
    },
  );
  it('rejects prices that would overflow committed cents on a twenty-seat reservation', async () => {
    const entry = cases[0];
    await expect(
      pipe.transform(
        {
          ...entry.payload,
          pricePerSeatCents: Math.floor(2_147_483_647 / 20) + 1,
        },
        { type: 'body', metatype: entry.dto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
