import { formatKwd, type Fils } from '@sanad/core';
import { resources, type Language } from '@sanad/i18n';

/** Display an amount with 3 decimals and the localised currency label, e.g. "100.000 د.ك". */
export function displayKwd(amount: Fils, language: Language): string {
  return `${formatKwd(amount)} ${resources[language].translation.common.currency}`;
}
