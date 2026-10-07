'use client';
import { useState } from 'react';
import { AdminHeader, ListState, Pagination } from '@/components/admin/AdminUi';
import { useAdminResource, type AdminPage } from '@/lib/admin-api';
import type { AuditEvent } from '@/lib/admin-types';
import { formatDate, queryString } from '@/lib/admin-utils';
export default function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [input, setInput] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);
  const resource = useAdminResource<AdminPage<AuditEvent>>(
    `/admin/audit?${queryString({ entityType, entityId, page, pageSize: 20 })}`,
  );
  return (
    <>
      <AdminHeader
        title="Auditoría"
        description="Cambios administrativos con responsable, fecha y datos anteriores y posteriores."
      />
      <section className="card">
        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setEntityId(input.trim());
            setPage(1);
          }}
        >
          <div className="field">
            <label htmlFor="audit-entity">Tipo de registro</label>
            <select
              id="audit-entity"
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="driver">Conductor</option>
              <option value="vehicle">Vehículo</option>
              <option value="document">Documento</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="audit-id">ID del registro (opcional)</label>
            <input
              id="audit-id"
              maxLength={36}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <button className="button secondary" type="submit">
            Filtrar
          </button>
        </form>
        <ListState {...resource} empty={!resource.data?.items.length}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Administrador</th>
                  <th>Acción</th>
                  <th>Registro</th>
                  <th>Cambios</th>
                </tr>
              </thead>
              <tbody>
                {resource.data?.items.map((event) => (
                  <tr key={event.auditId}>
                    <td>{formatDate(event.createdAt, true)}</td>
                    <td>
                      {event.actorName}
                      <small>{event.actorId}</small>
                    </td>
                    <td>{event.action.replace(/_/g, ' ')}</td>
                    <td>
                      {event.entityType}
                      <small>{event.entityId}</small>
                    </td>
                    <td>
                      <details>
                        <summary>Ver datos del cambio</summary>
                        <pre className="admin-event-payload">
                          {JSON.stringify(event.changes, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ListState>
        {resource.data && (
          <Pagination
            page={page}
            total={resource.data.total}
            pageSize={20}
            onPage={setPage}
            loading={resource.loading}
          />
        )}
      </section>
    </>
  );
}
