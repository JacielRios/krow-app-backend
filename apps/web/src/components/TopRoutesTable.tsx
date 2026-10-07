import { money, type RouteRow } from './dashboard-data';

export function TopRoutesTable({ rows }: { rows: RouteRow[] }) {
  if (rows.length === 0)
    return <p>No hay rutas con actividad en este periodo.</p>;
  const max = Math.max(...rows.map((r) => r.trips), 1);
  return (
    <div className="table-wrap">
      <table>
        <caption className="dashboard-caption">
          Rutas ordenadas por número de viajes publicados en el periodo
        </caption>
        <thead>
          <tr>
            <th scope="col">Ruta</th>
            <th scope="col">Viajes</th>
            <th scope="col">Ocupación</th>
            <th scope="col">Importe comprometido</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route}>
              <td>{r.route}</td>
              <td>
                <span className="trips-cell">
                  <span
                    className="trips-bar"
                    style={{ width: `${(r.trips / max) * 80}px` }}
                  />
                  {r.trips.toLocaleString('es-MX')}
                </span>
              </td>
              <td>{r.occupancy}%</td>
              <td>{money(r.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
