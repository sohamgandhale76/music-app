// NTP clock endpoint helper
// Returns client send time echoed back + server receive/send timestamps.
// Client uses: offset = ((serverReceive - clientSend) + (serverSend - clientReceive)) / 2
// Simplified: offset = serverTime - (clientSend + RTT/2)

function handleNtp(req, res) {
  const now = Date.now();
  res.json({
    clientSendTime: req.body.clientSendTime,
    serverReceiveTime: now,
    serverSendTime: now, // negligible diff between receive and send
    serverTime: now,
  });
}

module.exports = { handleNtp };
