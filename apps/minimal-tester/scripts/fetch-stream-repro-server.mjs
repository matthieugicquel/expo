import http from 'node:http';

const port = 9001;

const server = http.createServer((req, res) => {
  if (req.url !== '/stream') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-store',
  });

  const sequence = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  let index = 0;

  const sendNext = () => {
    if (index >= sequence.length) {
      res.end();
      return;
    }
    const token = `[[${sequence[index]}]]`;
    // Small payload to minimize network buffering
    const payload = token + sequence[index].repeat(64) + '\n';
    res.write(payload);
    index += 1;

    // Tight timing: 1-2ms delays to maximize chance of chunks arriving
    // during the critical window between state change and emit
    setTimeout(sendNext, 1);
  };

  sendNext();
});

server.listen(port, '0.0.0.0', () => {
  console.log(`fetch stream repro server listening on http://127.0.0.1:${port}/stream`);
});
