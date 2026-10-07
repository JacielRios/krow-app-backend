/*import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export default function PrivacyPage() {
  return (
    <div className="landing">
      <Navbar />
      <section className="page-hero">
        <h1>Aviso de Privacidad</h1>
        <p>Espacio reservado para el aviso de privacidad y las políticas aplicables al uso de KROW.</p>
      </section>
      <Footer />
    </div>
  );
}*/

import SobreNosotrosPage from "@/components/SobreNosotrosPage"; // Revisa que la ruta coincida con la ubicación real de tu componente

export const metadata = {
  title: "Sobre Nosotros | KROW",
  description: "Conoce la historia de KROW.",
};

export default function Page() {
  return <SobreNosotrosPage />;
}