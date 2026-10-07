export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <div className="footer-brand">
            <img src="/img/Logo_KROW.png" alt="" />
            KROW
          </div>
          <p>
            Carpooling inteligente para moverte mejor, gastar menos y reducir el
            tráfico.
          </p>
        </div>
        <div>
          <h4>Producto</h4>
          <a href="/#como-funciona">Cómo funciona</a>
          <a href="/#beneficios">Beneficios</a>
          <a href="/empresas">Para empresas</a>
        </div>
        <div>
          <h4>Compañía</h4>
          <a href="/sobre-nosotros">Sobre nosotros</a>
          <a href="/contacto">Contacto</a>
        </div>
        <div>
          <h4>Legal</h4>
          <a href="/privacidad">Privacidad</a>
          <a href="/terminos">Términos</a>
        </div>
      </div>
      <div className="footer-bottom">
        © {new Date().getFullYear()} KROW. Todos los derechos reservados.
      </div>
    </footer>
  );
}
