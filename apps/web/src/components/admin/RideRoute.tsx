import {
  decodeRoutePolyline,
  validMapPoint,
  type MapPoint,
} from '@/lib/admin-route';
import type { RideDetail } from '@/lib/admin-types';
export function RideRoute({ ride }: { ride: RideDetail }) {
  const stops = ride.route.stops.filter(validMapPoint);
  const decoded = decodeRoutePolyline(ride.route.polyline);
  const endpoints = [ride.origin, ride.destination].filter(validMapPoint);
  const points =
    decoded.length > 1
      ? decoded
      : [...endpoints.slice(0, 1), ...stops, ...endpoints.slice(1)];
  if (!points.length)
    return (
      <p className="admin-description">
        Este viaje no tiene coordenadas de ruta disponibles.
      </p>
    );
  const bounds = points.concat(stops);
  const minLat = Math.min(...bounds.map((point) => point.lat));
  const maxLat = Math.max(...bounds.map((point) => point.lat));
  const minLng = Math.min(...bounds.map((point) => point.lng));
  const maxLng = Math.max(...bounds.map((point) => point.lng));
  const project = (point: MapPoint) => ({
    x: 30 + ((point.lng - minLng) / Math.max(maxLng - minLng, 0.0001)) * 540,
    y: 230 - ((point.lat - minLat) / Math.max(maxLat - minLat, 0.0001)) * 200,
  });
  const path = points
    .map((point, index) => {
      const p = project(point);
      return `${index ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <>
      <svg
        className="admin-route-map"
        viewBox="0 0 600 260"
        role="img"
        aria-label={`Recorrido de ${ride.origin.address} a ${ride.destination.address}`}
      >
        <path
          d={path}
          fill="none"
          stroke="#5356ae"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {stops.map((stop, index) => {
          const p = project(stop);
          return (
            <g key={stop.stopId}>
              <circle
                cx={p.x}
                cy={p.y}
                r="9"
                fill="white"
                stroke="#5356ae"
                strokeWidth="2"
              />
              <text x={p.x} y={p.y + 4} textAnchor="middle">
                {index + 1}
              </text>
              <title>{stop.name}</title>
            </g>
          );
        })}
        {endpoints.map((point, index) => {
          const p = project(point);
          return (
            <circle
              key={index}
              cx={p.x}
              cy={p.y}
              r="7"
              fill={index ? '#20265a' : '#409270'}
            >
              <title>{index ? 'Destino' : 'Origen'}</title>
            </circle>
          );
        })}
      </svg>
      <p className="admin-description admin-small">
        Esquema geográfico del recorrido
        {decoded.length < 2 ? ' por sus paradas disponibles' : ''}. Las
        coordenadas corresponden al viaje registrado.
      </p>
      {endpoints.length === 2 && (
        <a
          className="admin-text-button"
          href={`https://www.google.com/maps/dir/?api=1&origin=${ride.origin.lat},${ride.origin.lng}&destination=${ride.destination.lat},${ride.destination.lng}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir origen y destino en Google Maps ↗
        </a>
      )}
      {stops.length > 0 && (
        <ol className="admin-stop-list">
          {stops.map((stop) => (
            <li key={stop.stopId}>
              {stop.name} {stop.address && `· ${stop.address}`}
              {!stop.isActive && ' (histórica)'}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
