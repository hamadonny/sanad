import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError, type IntentResponse } from '@sanad/api-client';
import { renderWithProviders } from '../test/render';
import { PaymentSheet } from './PaymentSheet';

jest.mock('../lib/api', () => ({
  api: { devConfirm: jest.fn(async () => ({ status: 'APPLIED', failureReason: null })) },
  isMockCheckout: (u: string) => u.startsWith('sanad-mock://'),
}));
jest.mock('../lib/query', () => ({ invalidateMoney: jest.fn(async () => undefined) }));

const { api } = jest.requireMock('../lib/api') as { api: { devConfirm: jest.Mock } };

const intent = (amountFils: string, penaltyFils = '0'): IntentResponse => ({
  checkoutUrl: 'sanad-mock://checkout/p1',
  payment: {
    id: 'p1',
    purpose: 'CONTRIBUTION',
    circleId: 'c1',
    month: 3,
    spot: null,
    amount: { fils: amountFils, kwd: (Number(amountFils) / 1000).toFixed(3) },
    penalty: { fils: penaltyFils, kwd: (Number(penaltyFils) / 1000).toFixed(3) },
    status: 'PENDING',
    createdAt: '2027-01-01',
    succeededAt: null,
    failureReason: null,
  },
});

describe('PaymentSheet — confirm exact amounts before paying', () => {
  beforeEach(() => api.devConfirm.mockClear());

  it('shows the server amount with 3 decimals and pays after confirmation', async () => {
    const create = jest.fn(async () => intent('100000'));
    const onPaid = jest.fn();
    await renderWithProviders(
      <PaymentSheet
        request={{ title: 'قسط الشهر 3', create }}
        onClose={() => undefined}
        onPaid={onPaid}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('payment-total')).toHaveTextContent('100.000 د.ك'),
    );
    expect(create).toHaveBeenCalledWith(expect.stringMatching(/^k-/));
    expect(api.devConfirm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('payment-confirm'));
    await waitFor(() => expect(screen.getByTestId('payment-success')).toBeTruthy());
    expect(api.devConfirm).toHaveBeenCalledWith('p1');
    expect(onPaid).toHaveBeenCalled();
  });

  it('breaks out a late penalty (to charity) from the contribution', async () => {
    await renderWithProviders(
      <PaymentSheet
        request={{ title: 'x', create: async () => intent('102000', '2000') }}
        onClose={() => undefined}
      />,
      { language: 'en' },
    );
    await waitFor(() =>
      expect(screen.getByTestId('payment-total')).toHaveTextContent('102.000 KWD'),
    );
    expect(screen.getByText('100.000 KWD')).toBeTruthy();
    expect(screen.getByText('2.000 KWD')).toBeTruthy();
    expect(screen.getByText('Late penalty (goes to charity)')).toBeTruthy();
  });

  it('shows the API error when the intent is refused', async () => {
    await renderWithProviders(
      <PaymentSheet
        request={{
          title: 'x',
          create: async () => Promise.reject(new ApiError(409, 'ALREADY_PAID', 'x')),
        }}
        onClose={() => undefined}
      />,
      { language: 'en' },
    );
    await waitFor(() => expect(screen.getByText('This month is already paid')).toBeTruthy());
  });
});
