// Moves the API clock (dev only) and runs the scheduler, e.g. to close an auction or reach a payout date.
const at = new Date(Date.now() + Number(DAYS) * 86400000).toISOString();
http.post(`${API_URL}/dev/clock?at=${encodeURIComponent(at)}`, { body: '' });
const tick = http.post(`${API_URL}/dev/tick`, { body: '' });
output.tick = json(tick.body);
