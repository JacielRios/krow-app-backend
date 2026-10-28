import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  methodLabel,
  money,
  number,
  type DriverWeeklyReport,
} from './driver-kit';

const NAVY: [number, number, number] = [26, 24, 80];
const GRAY: [number, number, number] = [91, 103, 112];

// Las fuentes estándar de PDF solo admiten Latin-1: se normalizan espacios
// especiales y flechas, y se sustituye cualquier otro carácter.
const clean = (value: string) =>
  value
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s*→\s*/g, ' a ')
    .replace(/[^\x20-\x7e\u00a1-\u00ff]/g, '?');

const longDate = (date: string) =>
  clean(
    new Intl.DateTimeFormat('es-MX', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${date}T00:00:00Z`)),
  );

const tripDate = (iso: string) =>
  clean(
    new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Monterrey',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso)),
  );

const finalY = (doc: jsPDF, fallback: number) =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
    ?.finalY ?? fallback;

export function buildWeeklyReportPdf(report: DriverWeeklyReport): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  const width = doc.internal.pageSize.getWidth();
  const from = longDate(report.weekStart);
  const to = longDate(report.weekEnd);

  // Encabezado
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, width, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('KROW', margin, 14);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Reporte semanal de ganancias', margin, 22);

  // Datos del reporte
  doc.setTextColor(20, 33, 31);
  doc.setFontSize(11);
  doc.text(clean(`Conductor: ${report.driverName ?? 'Sin nombre registrado'}`), margin, 40);
  doc.text(`Semana: del ${from} al ${to}`, margin, 46);
  doc.setTextColor(...GRAY);
  doc.setFontSize(9);
  doc.text(
    clean(
      `Generado el ${new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Monterrey',
        dateStyle: 'long',
      }).format(new Date())} (hora de Monterrey)`,
    ),
    margin,
    51,
  );

  // Total de la semana
  doc.setFillColor(238, 244, 243);
  doc.roundedRect(margin, 56, width - margin * 2, 16, 2, 2, 'F');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(
    clean(`En la semana del ${from} al ${to} ganaste ${money(report.totals.net)}`),
    margin + 4,
    66,
  );

  const head = { fillColor: NAVY, textColor: [255, 255, 255] as [number, number, number] };

  // Resumen
  autoTable(doc, {
    startY: 78,
    head: [['Resumen', '']],
    body: [
      ['Viajes realizados', number(report.totals.trips)],
      ['Pasajeros transportados', number(report.totals.passengers)],
      ['Cobrado a pasajeros', money(report.totals.gross)],
      ['Cargo por servicio', money(report.totals.retained)],
      ['Tu ganancia', money(report.totals.net)],
    ].map((row) => row.map(clean)),
    styles: { fontSize: 9.5 },
    headStyles: head,
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: margin, right: margin },
  });

  // Por forma de pago
  autoTable(doc, {
    startY: finalY(doc, 120) + 8,
    head: [['Forma de pago', 'Pagos', 'Pasajeros', 'Cobrado', 'Cargo', 'Ganancia']],
    body: report.byMethod.map((row) =>
      [
        methodLabel(row.method),
        number(row.payments),
        number(row.passengers),
        money(row.gross),
        money(row.retained),
        money(row.net),
      ].map(clean),
    ),
    styles: { fontSize: 9 },
    headStyles: head,
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  // Viajes
  const afterMethods = finalY(doc, 160) + 10;
  doc.setTextColor(20, 33, 31);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Viajes de la semana', margin, afterMethods);
  if (report.trips.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text('No hubo viajes realizados en esta semana.', margin, afterMethods + 6);
  } else {
    autoTable(doc, {
      startY: afterMethods + 3,
      head: [['Salida', 'Ruta', 'Pasajeros', 'Cobrado', 'Cargo', 'Ganancia']],
      body: report.trips.map((trip) =>
        [
          tripDate(trip.departureTime),
          `${trip.originAddress ?? 'Origen sin registrar'} → ${trip.destinationAddress ?? 'Destino sin registrar'}`,
          number(trip.passengers),
          money(trip.gross),
          money(trip.retained),
          money(trip.net),
        ].map(clean),
      ),
      styles: { fontSize: 8.5, cellPadding: 2 },
      headStyles: head,
      columnStyles: {
        0: { cellWidth: 26 },
        2: { halign: 'right', cellWidth: 20 },
        3: { halign: 'right', cellWidth: 22 },
        4: { halign: 'right', cellWidth: 22 },
        5: { halign: 'right', cellWidth: 24 },
      },
      margin: { left: margin, right: margin },
    });
  }

  // Nota y paginación
  const note = clean(
    `Recibes ${money(report.payPerPassenger)} por cada pasajero transportado, en efectivo o con tarjeta. El cargo por servicio es la diferencia entre lo que paga el pasajero y tu pago.`,
  );
  const pages = doc.getNumberOfPages();
  const height = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    if (page === pages)
      doc.text(doc.splitTextToSize(note, width - margin * 2) as string[], margin, height - 16);
    doc.text(`Pagina ${page} de ${pages}`, width - margin, height - 8, { align: 'right' });
  }
  return doc;
}

export function downloadWeeklyReportPdf(report: DriverWeeklyReport) {
  buildWeeklyReportPdf(report).save(`reporte-semanal-${report.weekStart}.pdf`);
}
