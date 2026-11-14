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
// room: { code, quick, status: waiting|countdown|playing|over, players (2-4), host seat, watchers: Set, startAt, winner seat, ranking }
// player: { ws, name, seat 0-3, st: last state, gone }
const rooms = new Map();
const now = () => Date.now();
const TESTLAG = +process.env.TESTLAG || 0; // testing only: simulate a slow, jittery network (ms)
const sendNow = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
const send = !TESTLAG ? sendNow : (ws, msg) => {
  if (!ws) return;
  const at = Math.max(ws._nextAt || 0, Date.now() + TESTLAG * (0.5 + Math.random() * 1.5) + (Math.random() < 0.05 ? TESTLAG * 2 : 0));
  ws._nextAt = at; setTimeout(() => sendNow(ws, msg), at - Date.now());
};
const cleanName = n => (String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim() || 'لاعب').slice(0, 14);
function newCode() { let c; do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(c)); return c; }

const MAX_PLAYERS = 4;
const QUICK_WAIT = 10000; // quick match: once 2 players are in, wait this long for more (or start at 4)

function newRoom(quick) {
  const r = { code: newCode(), quick, status: 'waiting', players: [], watchers: new Set(), startAt: 0, autoAt: 0, autoTimer: null,
              host: 0, winner: null, reason: null, ranking: null, created: now() };
  rooms.set(r.code, r);
  return r;
}
const active = r => r.players.filter(p => !p.gone);
const roster = r => r.players.map(p => ({ seat: p.seat, name: p.name, gone: !!p.gone }));
function freeSeat(r) { for (let s = 0; s < MAX_PLAYERS; s++) if (!r.players.some(p => p.seat === s)) return s; return -1; }
function sendLobby(r) {
  r.players.forEach(p => send(p.ws, { t: 'lobby', code: r.code, quick: r.quick, you: p.seat, host: r.host,
    players: roster(r), startIn: r.autoAt ? Math.max(0, r.autoAt - now()) : 0 }));
}
function addPlayer(r, ws, name) {
  const seat = freeSeat(r);
  const p = { ws, name: cleanName(name), seat, st: null, gone: false };
  r.players.push(p);
  ws.room = r; ws.player = p; ws.role = 'player';
  if (r.players.length === 1) r.host = seat;
  if (r.players.length >= MAX_PLAYERS) { startRoom(r); return; }
  if (r.quick && r.players.length >= 2 && !r.autoAt) {
    r.autoAt = now() + QUICK_WAIT;
    r.autoTimer = setTimeout(() => { if (r.status === 'waiting' && r.players.length >= 2) startRoom(r); }, QUICK_WAIT);
  }
  sendLobby(r);
}
function startRoom(r) {
  if (r.status !== 'waiting' || r.players.length < 2) return;
  clearTimeout(r.autoTimer);
  r.status = 'countdown'; r.startAt = now() + 4000;
  const list = roster(r);
  r.players.forEach(p => send(p.ws, { t: 'start', in: 4000, you: p.seat, players: list }));
  setTimeout(() => { if (r.status === 'countdown') r.status = 'playing'; }, 4000);
  broadcastWatch(r, info(r));
}
function info(r) {
  return { t: 'winfo', code: r.code, players: roster(r), status: r.status, since: r.startAt ? now() - r.startAt : 0,
    winner: r.winner, reason: r.reason, ranking: r.ranking, watchers: r.watchers.size };
}
function broadcastWatch(r, msg) { const s = JSON.stringify(msg); for (const w of r.watchers) send(w, s); }
function rankingOf(r, winnerSeat) {
  // winner first, then everyone else by height reached (smaller y = higher in the tower); quitters last
  const list = r.players.map(p => ({ seat: p.seat, name: p.name, lvl: p.st ? p.st.lvl : 0, y: p.st ? p.st.y : 0, gone: !!p.gone }));
  list.sort((a, b) => (b.seat === winnerSeat) - (a.seat === winnerSeat) || a.gone - b.gone || a.y - b.y);
  return list.map(({ seat, name, lvl, gone }) => ({ seat, name, lvl, gone }));
}
function endRoom(r, winnerSeat, reason) {
  if (r.status === 'over') return;
  r.status = 'over'; r.winner = winnerSeat; r.reason = reason; r.ranking = rankingOf(r, winnerSeat);
  const w = r.players.find(p => p.seat === winnerSeat), winnerName = w ? w.name : '';
  r.players.forEach(p => send(p.ws, { t: 'over', won: p.seat === winnerSeat, winner: winnerSeat, winnerName, reason, ranking: r.ranking }));
  broadcastWatch(r, { t: 'wover', winner: winnerSeat, winnerName, reason, ranking: r.ranking });
  setTimeout(() => rooms.delete(r.code), 60000); // keep a minute so late spectators still see the result
}
function leave(ws) {
  const r = ws.room; if (!r) return;
  if (ws.role === 'watcher') { r.watchers.delete(ws); notifyWatchers(r); }
  else if (ws.role === 'player') {
    const p = ws.player;
    if (r.status === 'waiting') {
      r.players = r.players.filter(x => x !== p);
      if (!r.players.length) { clearTimeout(r.autoTimer); rooms.delete(r.code); }
      else {
        if (r.host === p.seat) r.host = r.players[0].seat;
        if (r.players.length < 2 && r.autoAt) { clearTimeout(r.autoTimer); r.autoAt = 0; }
        sendLobby(r);
      }
    } else if (r.status !== 'over') {
      p.gone = true;
      r.players.forEach(x => { if (x !== p) send(x.ws, { t: 'gone', seat: p.seat }); });
      broadcastWatch(r, { t: 'wgone', seat: p.seat });
      const left = active(r);
      if (left.length === 1) endRoom(r, left[0].seat, 'left');
      else if (!left.length) { r.status = 'over'; setTimeout(() => rooms.delete(r.code), 60000); }
    }
  }
  ws.room = null; ws.player = null; ws.role = null;
}
function notifyWatchers(r) { r.players.forEach(p => send(p.ws, { t: 'watchers', n: r.watchers.size })); }
function matchList() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.status === 'waiting' || r.players.length < 2) continue;
    out.push({ code: r.code, players: roster(r), lvls: r.players.map(p => (p.st ? p.st.lvl : 0)), status: r.status,
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
        for (const x of rooms.values()) if (x.quick && x.status === 'waiting' && x.players.length < MAX_PLAYERS && x.players.every(p => p.ws.readyState === 1)) { r = x; break; }
        addPlayer(r || newRoom(true), ws, m.name);
        break;
      }
      case 'create': leave(ws); addPlayer(newRoom(false), ws, m.name); break;
      case 'join': {
        const r = rooms.get(String(m.code || '').trim());
        if (!r) { send(ws, { t: 'err', err: 'nocode' }); break; }
        if (r.players.length >= MAX_PLAYERS || r.status !== 'waiting') { send(ws, { t: 'err', err: 'full' }); break; }
        leave(ws); addPlayer(r, ws, m.name);
        break;
      }
      case 'begin': { // the room owner starts the match (code rooms)
        const r = ws.room;
        if (r && ws.role === 'player' && r.status === 'waiting' && r.host === ws.player.seat && r.players.length >= 2) startRoom(r);
        break;
      }
      case 'st': { // a player's state, ~30 times per second: forward it right away to everyone else
        const r = ws.room; if (!r || ws.role !== 'player' || r.status === 'over' || r.status === 'waiting') break;
        const p = ws.player; if (p.gone) break;
        const st = { lvl: m.lvl | 0, x: +m.x || 0, y: +m.y || 0, p: +m.p || 0, tl: +m.tl || 0, k: m.k | 0, alive: !!m.alive, vx: +m.vx || 0, vy: +m.vy || 0, ct: +m.ct || 0, m: m.m | 0 };
        p.st = st;
        const msg = JSON.stringify(Object.assign({ t: 'opp', seat: p.seat }, st));
        for (const o of r.players) if (o !== p && !o.gone) send(o.ws, msg);
        if (r.watchers.size) broadcastWatch(r, Object.assign({ t: 'w', i: p.seat }, st));
        if (m.fin && r.status === 'playing') endRoom(r, p.seat, 'finish');
        break;
      }
      case 'leave': leave(ws); break;
      case 'list': send(ws, { t: 'list', matches: matchList() }); break;
      case 'watch': {
        const r = rooms.get(String(m.code || ''));
        if (!r || r.status === 'waiting') { send(ws, { t: 'err', err: 'nomatch' }); break; }
        leave(ws);
        ws.room = r; ws.role = 'watcher'; r.watchers.add(ws);
        send(ws, info(r));
        r.players.forEach(p => { if (p.st && !p.gone) send(ws, Object.assign({ t: 'w', i: p.seat }, p.st)); });
        if (r.status === 'over') { const w = r.players.find(p => p.seat === r.winner); send(ws, { t: 'wover', winner: r.winner, winnerName: w ? w.name : '', reason: r.reason, ranking: r.ranking }); }
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
