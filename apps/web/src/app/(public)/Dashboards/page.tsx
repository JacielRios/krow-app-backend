// app/(public)/Dashboards/page.tsx
import DashboardPage from "@/components/DashboardPage";

export const metadata = {
  title: "Dashbaords |",
  description: "El analisis de la información al alcance de un clic.",
};

export default function Page() {
  return <DashboardPage />;
}