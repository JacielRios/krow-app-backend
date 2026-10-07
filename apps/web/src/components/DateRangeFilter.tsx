'use client';
import type { Range } from './dashboard-data';

const PRESETS = [
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
];

export function rangeFromDays(days: number, now = new Date()): Range {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Monterrey',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  const to = `${part('year')}-${part('month')}-${part('day')}`;
  const from = new Date(`${to}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days + 1);
  return { from: from.toISOString().slice(0, 10), to };
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: Range;
  onChange: (range: Range) => void;
}) {
  const active = PRESETS.find((preset) => {
    const range = rangeFromDays(preset.days);
    return range.from === value.from && range.to === value.to;
  });
  return (
    <div className="filter" role="group" aria-label="Filtrar por fecha">
      <div className="seg">
        {PRESETS.map((preset) => (
          <button
            key={preset.days}
            type="button"
            aria-pressed={active?.days === preset.days}
            onClick={() => onChange(rangeFromDays(preset.days))}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label>
        Desde
        <input
          type="date"
          value={value.from}
          max={value.to}
          required
          onChange={(event) => {
            if (event.target.value && event.target.value <= value.to)
              onChange({ ...value, from: event.target.value });
          }}
        />
      </label>
      <label>
        Hasta
        <input
          type="date"
          value={value.to}
          min={value.from}
          required
          onChange={(event) => {
            if (event.target.value && event.target.value >= value.from)
              onChange({ ...value, to: event.target.value });
          }}
        />
      </label>
    </div>
  );
}
