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
  options: [
    {
      monthly: m('100.000'),
      available: true,
      blockers: [],
      members: 10,
      months: 10,
      pot: m('1000.000'),
      organizingFee: m('30.000'),
      totalContributions: m('1000.000'),
      prioritySpots: [
        { spot: 1, minBid: m('30.000'), holdback: m('300.000'), receiveAtMinBid: m('670.000') },
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
  legal: { contractVersion: 1, lawyerApproved: false, contractDocument: null, shariah: null },
};

jest.mock('./lib/api', () => ({
  api: {
    auction: jest.fn(),
    bid: jest.fn(),
    options: jest.fn(),
    contract: jest.fn(),
    joinQueue: jest.fn(),
    requestSignCode: jest.fn(),
    signContract: jest.fn(),
    legalDocUrl: jest.fn(),
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
  it('shows pay, receive and the organising fee with 3 decimals, and how payouts work', async () => {
    useLocalSearchParams.mockReturnValue({ monthly: '100000' });
    api.options!.mockResolvedValue(options);
    api.contract!.mockResolvedValue(contract);
    await renderWithProviders(<JoinAmount />);
    await waitFor(() =>
      expect(screen.getByTestId('calc-receive')).toHaveTextContent('1,000.000 د.ك'),
    );
    expect(screen.getByTestId('calc-organizing-fee')).toHaveTextContent('30.000 د.ك');
    expect(screen.getByText('كيف تُصرف المبالغ')).toBeTruthy();
    expect(screen.queryByText(/مضمون/)).toBeNull();
  });
});

describe('contract e-signature', () => {
  it('agree → send signing code → sign with the code; shows placeholder + Shariah status', async () => {
    useLocalSearchParams.mockReturnValue({ monthly: '100000' });
    api.options!.mockResolvedValue(options);
    api.contract!.mockResolvedValue({ ...contract, signed: false });
    api.requestSignCode!.mockResolvedValue({ expiresIn: 300, devCode: '482913' });
    api.signContract!.mockResolvedValue({ version: 1, documentHash: 'x', signatureId: 's1' });
    api.joinQueue!.mockReturnValue(new Promise(() => undefined));
    await renderWithProviders(<JoinAmount />, { language: 'en' });
    await waitFor(() => expect(screen.getByTestId('join-continue')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('join-continue'));
    await waitFor(() => expect(screen.getByTestId('shariah-status')).toBeTruthy());
    expect(screen.getByText('Shariah review: not uploaded yet')).toBeTruthy();
    expect(screen.getByText(/placeholder until the lawyer approves/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('contract-agree'));
    await fireEvent.press(screen.getByTestId('contract-send-code'));
    await waitFor(() => expect(screen.getByTestId('contract-code')).toBeTruthy());
    expect(api.requestSignCode).toHaveBeenCalledWith(1, 'en');
    expect(screen.getByTestId('contract-code').props.value).toBe('482913');
    await fireEvent.press(screen.getByTestId('contract-sign'));
    await waitFor(() => expect(api.signContract).toHaveBeenCalledWith(1, '482913'));
  });
});
