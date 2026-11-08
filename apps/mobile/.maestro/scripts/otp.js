// Reads the latest OTP for PHONE from the API's dev SMS inbox.
const res = http.get(`${API_URL}/dev/sms?phone=${encodeURIComponent(PHONE)}`);
const messages = json(res.body);
const last = messages[messages.length - 1];
output.code = /(\d{6})/.exec(last.text)[1];
