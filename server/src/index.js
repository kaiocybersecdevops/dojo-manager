import { createServer } from 'node:http';
import { openDb, seed } from './db.js';
import { createApp } from './app.js';

const db = openDb(process.env.DB_FILE || 'dojo.db');
seed(db);

const port = Number(process.env.PORT || 3001);
createServer(createApp(db)).listen(port, () => {
  console.log(`Dojo Manager API running on http://localhost:${port}`);
});
