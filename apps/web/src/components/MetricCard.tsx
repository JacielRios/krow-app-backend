export type Tone = "trips" | "drivers" | "riders" | "money" | "alert";

interface Props { label: string; value: string; hint?: string; tone?: Tone; progress?: number }

export function MetricCard({ label, value, hint, tone = "trips", progress }: Props) {
  return (
    <article className={`metric tone-${tone}`}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {progress !== undefined && (
        <div className="bar" role="img" aria-label={`${label}: ${progress}%`}>
          <span style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
      {hint && <p className="metric-hint">{hint}</p>}
    </article>
  );
}
