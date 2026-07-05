const http = require('http');

console.log("Creating request...");
const req = http.get('http://127.0.0.1:3000/api/algo/sync?symbol=NQ_Historical_Data', (res) => {
  console.log("Got response headers. Status:", res.statusCode);
  res.on('data', (chunk) => {
    console.log("Got chunk of size:", chunk.length);
  });
  res.on('end', () => {
    console.log("Response ended.");
  });
});

req.on('socket', (socket) => {
  console.log("Socket assigned.");
  socket.on('lookup', () => console.log("DNS lookup complete."));
  socket.on('connect', () => console.log("Socket connected."));
  socket.on('timeout', () => console.log("Socket timeout."));
});

req.on('error', (err) => {
  console.error("Request error:", err);
});
