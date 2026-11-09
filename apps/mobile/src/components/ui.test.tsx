import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '../test/render';
import { StyleSheet } from 'react-native';
import { KeyValue, Money, T } from './ui';

describe('money display (spec §9.2)', () => {
  it('shows KWD with 3 decimals and an accessible label — Arabic', async () => {
    await renderWithProviders(<Money value={{ fils: '955000', kwd: '955.000' }} testID="m" />);
    expect(screen.getByTestId('m')).toHaveTextContent('955.000 د.ك');
    expect(screen.getByLabelText('955.000 د.ك')).toBeTruthy();
  });

  it('English and thousands separators', async () => {
    await renderWithProviders(<Money value={1_000_000n} testID="m" />, { language: 'en' });
    expect(screen.getByTestId('m')).toHaveTextContent('1,000.000 KWD');
  });

  it('Arabic-Indic numerals when enabled', async () => {
    await renderWithProviders(<Money value="45.000" testID="m" />, { arabicNumerals: true });
    expect(screen.getByTestId('m')).toHaveTextContent('٤٥.٠٠٠ د.ك');
  });

  it('key/value rows render the label and amount', async () => {
    await renderWithProviders(<KeyValue label="الإجمالي" value="100.000 د.ك" testID="kv" />);
    expect(screen.getByText('الإجمالي')).toBeTruthy();
    expect(screen.getByTestId('kv')).toHaveTextContent('100.000 د.ك');
  });

  it('Arabic text starts on the right: natural alignment with an RTL writing direction', async () => {
    await renderWithProviders(<T testID="t">نص</T>);
    const style = StyleSheet.flatten(screen.getByTestId('t').props.style);
    expect(style.textAlign).toBe('auto');
    expect(style.writingDirection).toBe('rtl');
  });
});
