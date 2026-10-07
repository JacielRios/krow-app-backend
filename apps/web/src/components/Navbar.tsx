"use client";
import { useState } from "react";

const LINKS = [
  { label: "Para Empresas", href: "/empresas" },
  { label: "Sobre Nosotros", href: "/sobre-nosotros" },
  { label: "Contacto", href: "/contacto" },
  { label: "Dashbaords", href: "/Dashboards"}
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="navbar">
      <a href="/" className="brand">
        <img src="/img/Logo_KROW.png" alt="" />
        KROW
      </a>
      <nav className={open ? "open" : ""} aria-label="Principal">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href}>{l.label}</a>
        ))}
        <a href="/admin/login" className="access">Acceso</a>
      </nav>
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-label="Abrir menú"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "✕" : "☰"}
      </button>
    </header>
  );
}
