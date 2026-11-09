import type { Response } from 'express';

/** Send a generated PDF (never cached: it may contain personal data). */
export function sendPdf(res: Response, data: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(data);
}

/** Send an uploaded/generated file as a download (never cached). */
export function sendFile(res: Response, data: Buffer, contentType: string, filename: string): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(data);
}
