"use client";
import type { Range } from "./mockData";

const PRESETS = [{ label: "7 días", days: 7 }, { label: "30 días", days: 30 }, { label: "90 días", days: 90 }];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function rangeFromDays(days: number): Range {
  const to = new Date(), from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
}

export function DateRangeFilter({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const active = PRESETS.find((p) => {
    const r = rangeFromDays(p.days);
    return r.from === value.from && r.to === value.to;
  });
  return (
    <div className="filter" role="group" aria-label="Filtrar por fecha">
      <div className="seg">
        {PRESETS.map((p) => (
          <button key={p.days} type="button" aria-pressed={active?.days === p.days}
            onClick={() => onChange(rangeFromDays(p.days))}>{p.label}</button>
        ))}
      </div>
      <label>Desde
        <input type="date" value={value.from} max={value.to}
          onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
      </label>
      <label>Hasta
        <input type="date" value={value.to} min={value.from}
          onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
      </label>
    </div>
  );
}
