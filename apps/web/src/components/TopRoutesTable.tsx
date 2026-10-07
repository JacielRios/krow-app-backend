import type { RouteRow } from "./mockData";

export function TopRoutesTable({ rows }: { rows: RouteRow[] }) {
  const max = Math.max(...rows.map((r) => r.trips), 1);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Ruta</th><th>Viajes</th><th>Ocupación</th><th>Ingresos</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route}>
              <td>{r.route}</td>
              <td>
                <span className="trips-cell">
                  <span className="trips-bar" style={{ width: `${(r.trips / max) * 80}px` }} />
                  {r.trips.toLocaleString("es-MX")}
                </span>
              </td>
              <td>{r.occupancy}%</td>
              <td>${r.revenue.toLocaleString("es-MX")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
