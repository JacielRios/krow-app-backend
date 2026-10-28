import { PERIODS, type PeriodKey } from './driver-data';

export function RangeTabs({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (key: PeriodKey) => void;
}) {
  return (
    <div className="drv-range" role="group" aria-label="Periodo">
      {PERIODS.map((period) => (
        <button
          key={period.key}
          type="button"
          aria-pressed={value === period.key}
          onClick={() => onChange(period.key)}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
