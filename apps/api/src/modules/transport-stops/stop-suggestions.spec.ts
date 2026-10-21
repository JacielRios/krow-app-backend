import { suggestStop } from './stop-suggestions.js';
const avenue = {
  corridorId: 'avenue',
  code: 'pablo-livas',
  name: 'Av. Pablo Livas',
  direction: null,
  active: true,
};
const catalog = [0, 1, 2].map((index) => ({
  stopId: `stop-${index}`,
  externalId: `krow-itnl-pablo-${['tolteca', 'serafin', 'hidalgo'][index]}`,
  latitude: 25.66,
  longitude: -100.24 + index * 0.01,
  active: true,
  corridorId: 'avenue',
  stopOrder: index + 1,
}));
const point = { latitude: 25.66, longitude: -100.225 };
const geocode = {
  formattedAddress: 'Av. Pablo Livas 123',
  municipality: 'Guadalupe',
  road: 'Avenida Pablo Livas',
  streetNumber: '123',
};
describe('evidence-based stop suggestions', () => {
  it('generates a unique KROW identifier and inserts at the geographic position, not at the end', () => {
    const result = suggestStop(point, geocode, [avenue], catalog);
    expect(result.values).toMatchObject({
      name: 'Avenida Pablo Livas · 123',
      address: geocode.formattedAddress,
      municipality: 'Guadalupe',
      corridorId: 'avenue',
      stopOrder: 3,
      direction: '',
      stopType: 'dropoff_only',
      ...point,
    });
    expect(result.values.externalId).toMatch(
      /^krow-itnl-pablo-descenso-[a-f0-9]{10}$/,
    );
    expect(result.shiftedStops).toBe(1);
    expect(result.directionSource).toBeNull();
  });
  it('reads explicit direction from a Google bus label but rejects opposite ordered geometry', () => {
    const input = {
      ...point,
      referenceName: 'GPE-0490 Av. Pablo Livas PTE - OTE',
    };
    const result = suggestStop(input, geocode, [avenue], catalog);
    expect(result.values.direction).toBe('Poniente a Oriente');
    expect(result.directionSource).toBe('google_reference_label');
    expect(result.values.stopOrder).toBe(3);
    const opposite = suggestStop(
      { ...input, referenceName: 'Av. Pablo Livas OTE - PTE' },
      geocode,
      [avenue],
      catalog,
    );
    expect(opposite.values.stopOrder).toBeNull();
  });
  it('does not invent municipality, road, direction or avenue when Google has no data', () => {
    const result = suggestStop(point, null, [avenue], catalog, true);
    expect(result.values).toMatchObject({
      municipality: '',
      address: '',
      direction: '',
      corridorId: '',
      stopOrder: null,
      name: 'Descenso 25.660000, -100.225000',
    });
    expect(
      result.warnings.some((text) => text.includes('consultar la dirección')),
    ).toBe(true);
  });
  it('does not infer an avenue from proximity alone, ambiguous names or inactive records', () => {
    expect(
      suggestStop(
        point,
        { ...geocode, road: 'Calle lateral' },
        [avenue],
        catalog,
      ).values.corridorId,
    ).toBe('');
    expect(
      suggestStop(
        point,
        geocode,
        [avenue, { ...avenue, corridorId: 'other' }],
        catalog,
      ).values.corridorId,
    ).toBe('');
    expect(
      suggestStop(point, geocode, [{ ...avenue, active: false }], catalog)
        .values.corridorId,
    ).toBe('');
  });
  it('leaves the order manual for distant, duplicate or sparse geometry and keeps the position', () => {
    expect(
      suggestStop({ ...point, latitude: 25.7 }, geocode, [avenue], catalog)
        .values.stopOrder,
    ).toBeNull();
    const duplicate = suggestStop(
      { ...point, longitude: catalog[0].longitude },
      geocode,
      [avenue],
      catalog,
    );
    expect(duplicate.values.stopOrder).toBeNull();
    expect(duplicate.warnings.some((text) => text.includes('5 m'))).toBe(true);
    expect(
      suggestStop(point, geocode, [avenue], catalog.slice(0, 1)).values
        .stopOrder,
    ).toBeNull();
  });
  it('honors a manual active avenue and avoids identifier collisions', () => {
    const first = suggestStop(
      { ...point, corridorId: 'avenue' },
      null,
      [avenue],
      catalog,
    );
    const second = suggestStop(
      { ...point, corridorId: 'avenue' },
      null,
      [avenue],
      [...catalog, { ...catalog[0], externalId: first.values.externalId }],
    );
    expect(first.values.corridorId).toBe('avenue');
    expect(second.values.externalId).not.toBe(first.values.externalId);
  });
});
