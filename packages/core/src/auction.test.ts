import { describe, expect, it } from 'vitest';
import {
  auctionResults,
  isAuctionClosed,
  leadingBid,
  minNextBid,
  myStatus,
  placeBid,
  publicView,
  startAuction,
  type AuctionState,
} from './auction.js';
import { kwd } from './money.js';

const START = '2027-01-01T09:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(START) + minutes * 60_000).toISOString();
const END_MIN = 48 * 60;

function fresh(): AuctionState {
  return startAuction({
    startedAt: START,
    durationMs: 48 * 3_600_000,
    minIncrement: kwd(5),
    antiSnipeMs: 5 * 60_000,
    minBids: [kwd(30), kwd(20), kwd(10)],
  });
}

const bid = (s: AuctionState, memberId: string, spot: number, amount: number, minute: number) =>
  placeBid(s, { memberId, spot, amount: kwd(amount), at: at(minute), maxAmount: kwd(1000) });

describe('auction', () => {
  it('enforces the minimum bid per spot and the 5% increment', () => {
    let s = fresh();
    expect(minNextBid(s, 1)).toBe(kwd(30));
    expect(() => bid(s, 'A', 1, 29, 1)).toThrow(/BID_TOO_LOW/);
    s = bid(s, 'A', 1, 30, 1);
    expect(minNextBid(s, 1)).toBe(kwd(35));
    expect(() => bid(s, 'B', 1, 34, 2)).toThrow(/BID_TOO_LOW/);
    s = bid(s, 'B', 1, 35, 2);
    expect(leadingBid(s, 1)?.memberId).toBe('B');
  });

  it('caps a bid at pot − holdback', () => {
    expect(() =>
      placeBid(fresh(), {
        memberId: 'A',
        spot: 1,
        amount: kwd(901),
        at: at(1),
        maxAmount: kwd(900),
      }),
    ).toThrow(/BID_TOO_HIGH/);
  });

  it('rejects bids on non-priority spots, before start and after close', () => {
    expect(() => bid(fresh(), 'A', 4, 50, 1)).toThrow(/NOT_PRIORITY_SPOT/);
    expect(() => bid(fresh(), 'A', 1, 50, -1)).toThrow(/AUCTION_NOT_STARTED/);
    expect(() => bid(fresh(), 'A', 1, 50, END_MIN)).toThrow(/SPOT_CLOSED/);
    expect(() =>
      placeBid(fresh(), {
        memberId: 'A',
        spot: 1,
        amount: kwd(50),
        at: 'nope',
        maxAmount: kwd(1000),
      }),
    ).toThrow(/INVALID_TIME/);
  });

  it('does not let the leader outbid themselves', () => {
    const s = bid(fresh(), 'A', 1, 30, 1);
    expect(() => bid(s, 'A', 1, 40, 2)).toThrow(/ALREADY_LEADING/);
  });

  it('one spot at a time: bidding elsewhere withdraws the old bid and the spot falls back', () => {
    let s = bid(fresh(), 'A', 1, 30, 1);
    s = bid(s, 'B', 1, 35, 2);
    s = bid(s, 'A', 2, 20, 3); // A withdraws from spot 1 (was outbid anyway)
    s = bid(s, 'C', 3, 10, 4);
    s = bid(s, 'C', 1, 40, 5); // C leaves spot 3 → spot 3 has no active bids
    expect(leadingBid(s, 3)).toBeUndefined();
    s = bid(s, 'B', 2, 25, 6); // B leaves spot 1 → C still leads it
    expect(leadingBid(s, 1)?.memberId).toBe('C');
    expect(leadingBid(s, 2)?.memberId).toBe('B');
    const active = s.bids.filter((b) => b.active);
    for (const m of ['A', 'B', 'C']) {
      expect(
        new Set(active.filter((b) => b.memberId === m).map((b) => b.spot)).size,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('a winner of a closed spot cannot bid on another spot', () => {
    let s = bid(fresh(), 'A', 1, 30, 1);
    s = { ...s, spots: s.spots.map((x) => (x.spot === 1 ? { ...x, endsAt: at(10) } : x)) };
    expect(() => bid(s, 'A', 2, 20, 11)).toThrow(/ALREADY_WON/);
    expect(bid(s, 'B', 2, 20, 11).bids).toHaveLength(2);
  });

  it('anti-sniping extends only the bid spot by 5 minutes', () => {
    const s = bid(fresh(), 'A', 1, 30, END_MIN - 3);
    expect(s.spots[0]?.endsAt).toBe(at(END_MIN + 5));
    expect(s.spots[1]?.endsAt).toBe(at(END_MIN));
    const t = bid(fresh(), 'A', 1, 30, END_MIN - 10);
    expect(t.spots[0]?.endsAt).toBe(at(END_MIN));
  });

  it('no anti-sniping when configured to 0', () => {
    const s0 = { ...fresh(), antiSnipeMs: 0 };
    expect(bid(s0, 'A', 1, 30, END_MIN - 1).spots[0]?.endsAt).toBe(at(END_MIN));
  });

  it('public view never contains identities; my status tracks lead/outbid/won/lost', () => {
    let s = bid(fresh(), 'A', 1, 30, 1);
    s = bid(s, 'B', 1, 35, 2);
    const view = publicView(s, at(3));
    expect(
      JSON.stringify(view, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    ).not.toMatch(/"A"|"B"/);
    expect(view[0]).toMatchObject({
      spot: 1,
      highestBid: kwd(35),
      minNextBid: kwd(40),
      closed: false,
    });
    expect(view[1]).toMatchObject({ highestBid: null, minNextBid: kwd(20) });
    expect(myStatus(s, 'A', 1, at(3))).toBe('OUTBID');
    expect(myStatus(s, 'B', 1, at(3))).toBe('LEADING');
    expect(myStatus(s, 'C', 1, at(3))).toBe('NONE');
    expect(myStatus(s, 'B', 1, at(END_MIN))).toBe('WON');
    expect(myStatus(s, 'A', 1, at(END_MIN))).toBe('LOST');
  });

  it('results require every spot closed and list only spots with bids', () => {
    const s = bid(fresh(), 'A', 2, 20, 1);
    expect(() => auctionResults(s, at(10))).toThrow(/AUCTION_OPEN/);
    expect(isAuctionClosed(s, at(END_MIN))).toBe(true);
    expect(auctionResults(s, at(END_MIN))).toEqual([{ spot: 2, memberId: 'A', amount: kwd(20) }]);
  });
});
