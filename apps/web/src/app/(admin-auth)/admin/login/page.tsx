export default function AdminLoginPage() {
  return (
    <div className="login-page">
      <section className="card login-card">
        <p className="brand">KROW</p>
        <h2>Acceso administrativo</h2>
        <p className="placeholder">
          La autenticación se conectará a Supabase Auth cuando se implemente el
          control de acceso administrativo.
        </p>
        <div className="field">
          <label htmlFor="email">Correo</label>
          <input id="email" type="email" disabled placeholder="administrador@krow.mx" />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" disabled placeholder="••••••••" />
        </div>
        <button className="button" type="button" disabled>Próximamente</button>
      </section>
    </div>
  );
}
