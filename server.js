// PALON online server: serves the game + real-time 1v1 races + spectators (WebSocket).
// Run: npm install && npm start   (PORT env var is respected, default 3000)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

/* ---------------- static files ---------------- */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------------- rooms ---------------- */
// room: { code, quick, status: waiting|countdown|playing|over, players: [p,p], watchers: Set, startAt, winner, reason }
// player: { ws, name, st: last state }
const rooms = new Map();
const now = () => Date.now();
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
const cleanName = n => (String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim() || 'لاعب').slice(0, 14);
function newCode() { let c; do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(c)); return c; }

function newRoom(quick) {
  const r = { code: newCode(), quick, status: 'waiting', players: [], watchers: new Set(), startAt: 0, winner: null, reason: null, created: now() };
  rooms.set(r.code, r);
  return r;
}
function addPlayer(r, ws, name) {
  const p = { ws, name: cleanName(name), st: null };
  r.players.push(p);
  ws.room = r; ws.player = p; ws.role = 'player';
  send(ws, { t: 'room', code: r.code, you: r.players.length, status: r.status });
  if (r.players.length === 2) {
    r.status = 'countdown'; r.startAt = now() + 4000;
    r.players.forEach((pl, i) => send(pl.ws, { t: 'start', in: 4000, opp: r.players[1 - i].name }));
    setTimeout(() => { if (r.status === 'countdown') r.status = 'playing'; }, 4000);
    broadcastWatch(r, info(r));
  }
}
function info(r) {
  return { t: 'winfo', code: r.code, names: r.players.map(p => p.name), status: r.status, since: r.startAt ? now() - r.startAt : 0,
    winner: r.winner === null ? null : r.winner, reason: r.reason, watchers: r.watchers.size };
}
function broadcastWatch(r, msg) { const s = JSON.stringify(msg); for (const w of r.watchers) send(w, s); }
function endRoom(r, winnerIdx, reason) {
  if (r.status === 'over') return;
  r.status = 'over'; r.winner = winnerIdx; r.reason = reason;
  r.players.forEach((p, i) => send(p.ws, { t: 'over', won: i === winnerIdx, reason, winnerName: r.players[winnerIdx] ? r.players[winnerIdx].name : '' }));
  broadcastWatch(r, { t: 'wover', winner: winnerIdx, winnerName: r.players[winnerIdx] ? r.players[winnerIdx].name : '', reason });
  setTimeout(() => rooms.delete(r.code), 60000); // keep a minute so late spectators still see the result
}
function leave(ws) {
  const r = ws.room; if (!r) return;
  if (ws.role === 'watcher') { r.watchers.delete(ws); notifyWatchers(r); }
  else if (ws.role === 'player') {
    const idx = r.players.indexOf(ws.player);
    if (r.status === 'waiting') rooms.delete(r.code);
    else if (r.status !== 'over' && idx >= 0) endRoom(r, 1 - idx, 'left');
  }
  ws.room = null; ws.player = null; ws.role = null;
}
function notifyWatchers(r) { r.players.forEach(p => send(p.ws, { t: 'watchers', n: r.watchers.size })); }
function matchList() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.players.length < 2) continue;
    out.push({ code: r.code, names: r.players.map(p => p.name), lvls: r.players.map(p => (p.st ? p.st.lvl : 0)), status: r.status,
      watchers: r.watchers.size, winner: r.winner, since: r.startAt ? now() - r.startAt : 0 });
  }
  out.sort((a, b) => (a.status === 'over') - (b.status === 'over') || b.watchers - a.watchers);
  return out.slice(0, 30);
}

/* ---------------- websocket ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false, maxPayload: 4096 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    switch (m.t) {
      case 'ping': send(ws, { t: 'pong', ct: m.ct }); break;
      case 'quick': {
        leave(ws);
        let r = null;
        for (const x of rooms.values()) if (x.quick && x.status === 'waiting' && x.players.length === 1 && x.players[0].ws.readyState === 1) { r = x; break; }
        addPlayer(r || newRoom(true), ws, m.name);
        break;
      }
      case 'create': leave(ws); addPlayer(newRoom(false), ws, m.name); break;
      case 'join': {
        const r = rooms.get(String(m.code || '').trim());
        if (!r) { send(ws, { t: 'err', err: 'nocode' }); break; }
        if (r.players.length >= 2 || r.status !== 'waiting') { send(ws, { t: 'err', err: 'full' }); break; }
        leave(ws); addPlayer(r, ws, m.name);
        break;
      }
      case 'st': { // a player's state, ~20 times per second: forward it right away
        const r = ws.room; if (!r || ws.role !== 'player' || r.status === 'over') break;
        const idx = r.players.indexOf(ws.player); if (idx < 0) break;
        const st = { lvl: m.lvl | 0, x: +m.x || 0, y: +m.y || 0, p: +m.p || 0, tl: +m.tl || 0, k: m.k | 0, alive: !!m.alive, vx: +m.vx || 0, vy: +m.vy || 0, ct: +m.ct || 0, m: m.m | 0 };
        ws.player.st = st;
        const other = r.players[1 - idx];
        if (other) send(other.ws, Object.assign({ t: 'opp' }, st));
        if (r.watchers.size) broadcastWatch(r, Object.assign({ t: 'w', i: idx }, st));
        if (m.fin && r.status === 'playing') endRoom(r, idx, 'finish');
        break;
      }
      case 'leave': leave(ws); break;
      case 'list': send(ws, { t: 'list', matches: matchList() }); break;
      case 'watch': {
        const r = rooms.get(String(m.code || ''));
        if (!r || r.players.length < 2) { send(ws, { t: 'err', err: 'nomatch' }); break; }
        leave(ws);
        ws.room = r; ws.role = 'watcher'; r.watchers.add(ws);
        send(ws, info(r));
        r.players.forEach((p, i) => { if (p.st) send(ws, Object.assign({ t: 'w', i }, p.st)); });
        if (r.status === 'over') send(ws, { t: 'wover', winner: r.winner, winnerName: r.players[r.winner] ? r.players[r.winner].name : '', reason: r.reason });
        notifyWatchers(r);
        break;
      }
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// drop dead connections + stale rooms
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) {} }
  for (const r of rooms.values()) if (r.status === 'waiting' && now() - r.created > 10 * 60 * 1000) rooms.delete(r.code);
}, 10000);

server.listen(PORT, () => console.log('PALON server on port ' + PORT));
