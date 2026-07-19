import PDFDocument from 'pdfkit';

export type AuditReportEvent = {
  actorDisplayName: string | null;
  actorEmail: string | null;
  actorId: string | null;
  actorType: string | null;
  correlationId: string | null;
  documentId: string | null;
  eventCategory: string | null;
  eventType: string | null;
  ipAddress: string | null;
  metadata: unknown;
  newState: unknown;
  occurredAt: string | null;
  previousState: unknown;
  requestId: string | null;
  serviceName: string | null;
  severity: string | null;
  source: string | null;
  subjectDisplayName: string | null;
  subjectId: string | null;
  subjectType: string | null;
  userAgent: string | null;
};

type AuditReportInput = {
  appliedFilters: Record<string, string>;
  events: AuditReportEvent[];
  exportedEventCount: number;
  generatedAt: string;
  isFiltered: boolean;
  totalMatchingEvents: number;
  unfilteredLimit: number | null;
};

const colours = {
  ink: '#111111',
  line: '#a9aea6',
  muted: '#555b55',
  surface: '#eef1eb',
};

const humanize = (value?: string | null) =>
  value
    ? value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[._\s-]+/)
        .filter(Boolean)
        .map((part) => {
          const normalized = part.toLowerCase();

          if (normalized === 'id') return 'ID';
          if (normalized === 'ip') return 'IP';
          if (normalized === 'url') return 'URL';

          return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
        })
        .join(' ')
    : 'Not recorded';

const eventTitle = (value?: string | null) =>
  value
    ? value.split('.').filter(Boolean).map(humanize).join(' / ')
    : 'Unknown event';

const printableValue = (value: unknown) => {
  if (value === null || typeof value === 'undefined') return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

const flattenValue = (
  value: unknown,
  prefix = ''
): Array<{ label: string; value: string }> => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return prefix ? [{ label: prefix, value: 'None recorded' }] : [];
    }

    return value.flatMap((item, index) =>
      flattenValue(item, `${prefix}${prefix ? ' / ' : ''}Item ${index + 1}`)
    );
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return prefix ? [{ label: prefix, value: 'None recorded' }] : [];
    }

    return entries.flatMap(([key, child]) =>
      flattenValue(child, `${prefix}${prefix ? ' / ' : ''}${humanize(key)}`)
    );
  }

  return prefix ? [{ label: prefix, value: printableValue(value) }] : [];
};

const detailRows = (event: AuditReportEvent) => [
  ...flattenValue(event.metadata, 'Metadata'),
  ...flattenValue(event.previousState, 'Previous state'),
  ...flattenValue(event.newState, 'New state'),
  ...flattenValue(
    {
      correlationId: event.correlationId,
      userAgent: event.userAgent,
    },
    'Technical context'
  ),
];

const chunkText = (value: string, maximumLength = 700) => {
  const chunks: string[] = [];
  let remaining = value;

  while (remaining.length > maximumLength) {
    const candidate = remaining.slice(0, maximumLength + 1);
    const breakAt = Math.max(
      candidate.lastIndexOf(' '),
      candidate.lastIndexOf('\n'),
      maximumLength
    );

    chunks.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }

  if (remaining || chunks.length === 0) {
    chunks.push(remaining);
  }

  return chunks;
};

const formatOccurredAt = (value: string | null) => {
  if (!value) return 'Not recorded';

  const date = new Date(value);

  return Number.isFinite(date.getTime())
    ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
    : 'Not recorded';
};

const safeFileNameDate = (value: string) => value.replace(/[:.]/g, '-');

export const auditReportFileName = (generatedAt: string) =>
  `hireflip-audit-logs-${safeFileNameDate(generatedAt)}.pdf`;

export const renderAuditReportPdf = ({
  appliedFilters,
  events,
  exportedEventCount,
  generatedAt,
  isFiltered,
  totalMatchingEvents,
  unfilteredLimit,
}: AuditReportInput) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      layout: 'landscape',
      margins: {
        bottom: 36,
        left: 36,
        right: 36,
        top: 36,
      },
      size: 'A4',
    });

    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageBottom = () => doc.page.height - doc.page.margins.bottom;
    const addPage = () => {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
    };
    const ensureSpace = (height: number) => {
      if (doc.y + height > pageBottom()) {
        addPage();
      }
    };

    doc.fillColor(colours.ink).font('Helvetica-Bold').fontSize(18).text('HireFlip Audit Logs');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(8).fillColor(colours.muted);
    doc.text(`Generated: ${formatOccurredAt(generatedAt)}`);
    doc.text(
      isFiltered
        ? `Scope: all ${totalMatchingEvents} matching events`
        : `Scope: first ${exportedEventCount} of ${totalMatchingEvents} events (unfiltered limit ${unfilteredLimit || 100})`
    );

    const filterEntries = Object.entries(appliedFilters);

    if (filterEntries.length > 0) {
      doc.text(`Filters: ${filterEntries.map(([key, value]) => `${humanize(key)} = ${value}`).join('; ')}`);
    } else {
      doc.text('Filters: none');
    }

    doc.moveDown(0.7);

    const renderEvent = (event: AuditReportEvent, index: number) => {
      const cardX = doc.page.margins.left;
      const cardWidth = contentWidth;
      const headerHeight = 34;
      let segmentStartY = doc.y;

      const finishSegment = () => {
        const endY = Math.min(pageBottom(), doc.y + 5);

        doc.save();
        doc.lineWidth(0.7).strokeColor(colours.line).rect(
          cardX,
          segmentStartY,
          cardWidth,
          Math.max(headerHeight, endY - segmentStartY)
        ).stroke();
        doc.restore();
        doc.y = endY + 7;
      };

      const startSegment = (continued = false) => {
        ensureSpace(continued ? 58 : 88);
        segmentStartY = doc.y;
        const headerY = doc.y;
        const fields = [
          ['Severity', humanize(event.severity)],
          ['Document ID', event.documentId || 'Not recorded'],
          ['Category', humanize(event.eventCategory)],
          ['Source', humanize(event.source)],
          ['Occurred', formatOccurredAt(event.occurredAt)],
        ];
        const columnWidth = cardWidth / fields.length;

        doc.save();
        doc.fillColor(colours.surface).rect(cardX, headerY, cardWidth, headerHeight).fill();
        fields.forEach(([label, value], fieldIndex) => {
          const x = cardX + fieldIndex * columnWidth + 7;
          const width = columnWidth - 14;

          doc.fillColor(colours.muted).font('Helvetica-Bold').fontSize(5.5).text(
            label.toUpperCase(),
            x,
            headerY + 5,
            { lineBreak: false, width }
          );
          doc.fillColor(colours.ink).font('Helvetica-Bold').fontSize(7).text(
            value,
            x,
            headerY + 15,
            { ellipsis: true, height: 13, width }
          );
        });
        doc.restore();
        doc.x = cardX + 8;
        doc.y = headerY + headerHeight + 6;

        if (continued) {
          doc.font('Helvetica-Bold').fontSize(8).fillColor(colours.ink).text(
            `${eventTitle(event.eventType)} (continued)`,
            { width: cardWidth - 16 }
          );
          doc.moveDown(0.35);
        }
      };

      const continueSegment = () => {
        finishSegment();
        addPage();
        startSegment(true);
      };

      const renderWrapped = ({
        font = 'Helvetica',
        fontSize = 6.8,
        text,
      }: {
        font?: string;
        fontSize?: number;
        text: string;
      }) => {
        chunkText(text).forEach((textChunk) => {
          doc.font(font).fontSize(fontSize);
          const height = doc.heightOfString(textChunk, {
            lineGap: 1,
            width: cardWidth - 16,
          });

          if (doc.y + height + 7 > pageBottom()) {
            continueSegment();
          }

          doc.fillColor(colours.ink).text(textChunk, cardX + 8, doc.y, {
            lineGap: 1,
            width: cardWidth - 16,
          });
        });
      };

      startSegment();
      renderWrapped({
        font: 'Helvetica-Bold',
        fontSize: 9,
        text: `${index + 1}. ${eventTitle(event.eventType)}`,
      });
      renderWrapped({ fontSize: 6.5, text: event.eventType || 'No event type' });
      doc.moveDown(0.25);
      renderWrapped({
        text: [
          `Actor: ${event.actorDisplayName || event.actorEmail || event.actorType || 'System'}${event.actorId ? ` (${event.actorId})` : ''}`,
          `Subject: ${event.subjectDisplayName || event.subjectType || 'No subject'}${event.subjectId ? ` (${event.subjectId})` : ''}`,
          `Request: ${event.requestId || 'Not recorded'}${event.ipAddress ? ` / IP ${event.ipAddress}` : ''}`,
        ].join('    |    '),
      });

      for (const row of detailRows(event)) {
        renderWrapped({ text: `${row.label}: ${row.value}` });
      }

      finishSegment();
    };

    if (events.length === 0) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(colours.ink).text('No audit events matched this export.');
    } else {
      events.forEach(renderEvent);
    }

    doc.end();
  });
