'use strict';

const express = require('express');
const path = require('path');
const keyManager = require('./lib/keyManager');
const issuerRouter = require('./routes/issuer');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/issuer', issuerRouter);

app.get('/demo', (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'demo.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Initialize key at startup so the first request doesn't block
keyManager.loadOrGenerateKey();

app.listen(PORT, () => {
  console.log(`NotBigBrother running on http://localhost:${PORT}`);
});
