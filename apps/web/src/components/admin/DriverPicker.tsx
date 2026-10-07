'use client';
import { useState } from 'react';
import { useAdminResource, type AdminPage } from '@/lib/admin-api';
import type { Driver } from '@/lib/admin-types';
import { queryString } from '@/lib/admin-utils';
export function DriverPicker({
  value,
  onChange,
  required = false,
  label = 'Conductor',
  id = 'driver-filter',
  initialName,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  label?: string;
  id?: string;
  initialName?: string;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading } = useAdminResource<AdminPage<Driver>>(
    `/admin/drivers?${queryString({ q: query, pageSize: 100 })}`,
  );
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="admin-row">
        <input
          aria-label={`Buscar ${label.toLowerCase()}`}
          placeholder="Buscar por nombre o correo"
          maxLength={120}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              setQuery(input.trim());
            }
          }}
        />
        <button
          className="button secondary"
          type="button"
          onClick={() => setQuery(input.trim())}
        >
          Buscar
        </button>
      </div>
      <select
        id={id}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {required ? 'Seleccionar conductor' : 'Todos los conductores'}
        </option>
        {value && !data?.items.some((item) => item.driverId === value) && (
          <option value={value}>
            {initialName || 'Conductor seleccionado'}
          </option>
        )}
        {data?.items.map((item) => (
          <option value={item.driverId} key={item.driverId}>
            {item.fullName} · {item.email}
          </option>
        ))}
      </select>
      {loading && <small role="status">Cargando conductores…</small>}
      {error && <small role="alert">{error}</small>}
      {data && data.total > data.pageSize && (
        <small>Busca por nombre para encontrar otros conductores.</small>
      )}
    </div>
  );
}
