import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from './api';

/** Download a PDF from the API (with the member's token) and open the share/preview sheet. */
export async function openPdf(url: string, filename: string, auth = true): Promise<void> {
  const dir = new Directory(Paths.cache, 'documents');
  if (!dir.exists) dir.create();
  const file = await File.downloadFileAsync(url, new File(dir, filename), {
    headers: auth ? await api.authHeader() : {},
    idempotent: true,
  });
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
