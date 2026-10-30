// Lets another computer on the network reach the local Supabase stack.
//
// Docker Desktop publishes the stack's ports on 127.0.0.1 only on this machine, even
// though `docker port` says 0.0.0.0, so a phone or another computer on the network
// times out when it reaches for the server.
//
// This listens on the computer's network address and passes everything to the server
// on 127.0.0.1. It only forwards to the loopback address, so it cannot be used to
// reach anything else.
//
//   node scripts\lan-server-proxy.cjs [address] [from] [to]

const http = require("node:http");

const ADDRESS = process.argv[2] || "10.0.0.180";
const FROM = Number(process.argv[3] || 54321);
const TO = Number(process.argv[4] || 54321);

const server = http.createServer((req, res) => {
  const options = {
    hostname: "127.0.0.1",
    port: TO,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${TO}` },
  };
  const upstream = http.request(options, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `The local server did not answer: ${err.message}` }));
  });
  req.pipe(upstream);
});

server.on("error", (err) => {
  console.error(`Could not listen on ${ADDRESS}:${FROM} — ${err.message}`);
  process.exit(1);
});

server.listen(FROM, ADDRESS, () => {
  console.log(`The local server is now reachable at http://${ADDRESS}:${FROM}`);
  console.log(`It forwards to 127.0.0.1:${TO}. Press Ctrl+C to stop.`);
});
