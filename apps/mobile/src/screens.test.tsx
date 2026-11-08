/** Money-display screens with a mocked API (spec §17: component tests for money screens). */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { AuctionView, OptionsResponse, ContractResponse } from '@sanad/api-client';
import AuctionScreen from './app/circle/[id]/auction';
import JoinAmount from './app/join/[monthly]';
import { renderWithProviders } from './test/render';

const m = (kwd: string) => ({ kwd, fils: String(Math.round(Number(kwd) * 1000)) });

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

const auction: AuctionView = {
  status: 'AUCTION',
  pot: m('1000.000'),
  canBid: true,
  winners: [],
  spots: [
    {
      spot: 1,
      highestBid: m('35.000'),
      minNextBid: m('40.000'),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      closed: false,
      myStatus: 'NONE',
      myHoldback: m('100.000'),
      receiveIfWinAtMin: m('860.000'),
    },
    {
      spot: 2,
      highestBid: null,
      minNextBid: m('20.000'),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      closed: false,
      myStatus: 'LEADING',
      myHoldback: m('100.000'),
      receiveIfWinAtMin: m('880.000'),
    },
  ],
};

const options: OptionsResponse = {
  kycStatus: 'APPROVED',
  contractSigned: true,
  circuitBreaker: 'NORMAL',
  options: [
    {
      monthly: m('100.000'),
      available: true,
      blockers: [],
      members: 10,
      months: 10,
      pot: m('1000.000'),
      entryFee: m('100.000'),
      totalContributions: m('1000.000'),
      refundBySpot: Array.from({ length: 10 }, (_, i) => ({
        spot: i + 1,
        refund: m(i < 5 ? '0.000' : i < 7 ? '50.000' : '100.000'),
      })),
      prioritySpots: [
        { spot: 1, minBid: m('30.000'), holdback: m('100.000'), receiveAtMinBid: m('870.000') },
      ],
      canBid: true,
    },
  ],
};

const contract: ContractResponse = {
  version: 1,
  titleAr: 'عقد',
  titleEn: 'Agreement',
  bodyAr: 'نص',
  bodyEn: 'Text',
  sha256: 'x',
  signed: true,
};

jest.mock('./lib/api', () => ({
  api: {
    auction: jest.fn(),
    bid: jest.fn(),
    options: jest.fn(),
    contract: jest.fn(),
    joinQueue: jest.fn(),
  },
  isMockCheckout: () => true,
}));
const { api } = jest.requireMock('./lib/api') as { api: Record<string, jest.Mock> };
const { useLocalSearchParams } = jest.requireMock('expo-router') as {
  useLocalSearchParams: jest.Mock;
};

describe('auction screen', () => {
  it('shows bids and previews exactly what the member receives', async () => {
    useLocalSearchParams.mockReturnValue({ id: 'c1' });
    api.auction!.mockResolvedValue(auction);
    await renderWithProviders(<AuctionScreen />, { language: 'en' });
    await waitFor(() => expect(screen.getByText('35.000 KWD')).toBeTruthy());
    expect(screen.getByText('You lead')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bid-spot-1'));
    await waitFor(() => expect(screen.getByTestId('bid-preview')).toBeTruthy());
    // 1,000 pot − 40 bid − 100 holdback = 860
    expect(screen.getByTestId('bid-preview')).toHaveTextContent(
      'If you win spot 1 at 40.000 KWD you will receive 860.000 KWD in month 1.',
    );
    expect(screen.getByText('Bidding here withdraws your bid on spot 2.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('bid-input'), '45.5');
    await waitFor(() =>
      expect(screen.getByTestId('bid-preview')).toHaveTextContent(/you will receive 854\.500 KWD/),
    );
    await fireEvent.changeText(screen.getByTestId('bid-input'), '39');
    await waitFor(() => expect(screen.getByText('Bid is below the minimum')).toBeTruthy());
  });
});

describe('join calculator', () => {
  it('shows pay, receive, fee and refunds with 3 decimals', async () => {
    useLocalSearchParams.mockReturnValue({ monthly: '100000' });
    api.options!.mockResolvedValue(options);
    api.contract!.mockResolvedValue(contract);
    await renderWithProviders(<JoinAmount />);
    await waitFor(() =>
      expect(screen.getByTestId('calc-receive')).toHaveTextContent('1,000.000 د.ك'),
    );
    expect(screen.getByTestId('calc-entry-fee')).toHaveTextContent('100.000 د.ك');
    expect(screen.getAllByText('50.000 د.ك')).toHaveLength(2);
    expect(screen.getAllByText('100.000 د.ك').length).toBeGreaterThanOrEqual(3);
  });
});
