export function AdminSection({ title, description }: { title: string; description: string }) {
  return (
    <>
      <header className="admin-header"><div><p className="eyebrow">Administración</p><h2>{title}</h2></div></header>
      <section className="card"><p className="placeholder">{description}</p></section>
    </>
  );
}
