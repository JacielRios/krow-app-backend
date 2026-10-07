'use client';
import { useState } from 'react';

const LINKS = [
  { label: 'Para Empresas', href: '/empresas' },
  { label: 'Sobre Nosotros', href: '/sobre-nosotros' },
  { label: 'Contacto', href: '/contacto' },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="navbar">
      <a href="/" className="brand">
        <img src="/img/Logo_KROW.png" alt="" />
        KROW
      </a>
      <nav
        id="public-navigation"
        className={open ? 'open' : ''}
        aria-label="Principal"
      >
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </a>
        ))}
        <a href="/admin/login" className="access">
          Acceso administrativo
        </a>
      </nav>
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="public-navigation"
        aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '✕' : '☰'}
      </button>
    </header>
  );
}
