// CORE-X — שומר "הלוח לא מקוון" (רץ ב-GitHub Actions כל 5 דקות).
// לכל לוח: מתחבר לשרת ה-MQTT עם פרטי הטלפון (אותם u/k שבקישור ההזמנה), קורא את ההודעה השמורה
// kinet/<dev>/out/online ("1" = מחובר, "0" = הברוקר ראה אותו נעלם), ומשווה למה שהיה בריצה הקודמת.
// שינוי 1→0: התראה דחופה. שינוי 0→1: התראה שהוא חזר. בלי שינוי — כלום.
import mqtt from 'mqtt';
import fs from 'node:fs';

const STATE = 'state.json';
let boards = [];
try { boards = JSON.parse(process.env.CORE_X_BOARDS || '[]'); } catch (e) { console.error('CORE_X_BOARDS is not valid JSON'); process.exit(1); }
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) {}

function readOnline(b) {
  return new Promise((resolve) => {
    const url = `wss://${b.host}:${b.port || 8084}/mqtt`;
    const c = mqtt.connect(url, { username: b.user || b.dev, password: b.pass, clientId: `corex-watch-${b.dev}-${Date.now() % 100000}`,
                                  reconnectPeriod: 0, connectTimeout: 15000, clean: true });
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { c.end(true); } catch (e) {} resolve(v); };
    c.on('connect', () => c.subscribe(`kinet/${b.dev}/out/online`, { qos: 1 }, (err) => { if (err) finish({ err: 'subscribe: ' + err.message }); }));
    c.on('message', (t, m) => finish({ v: m.toString().trim() }));
    c.on('error', (e) => finish({ err: e.message }));
    setTimeout(() => finish({ v: null }), 8000);     // אין הודעה שמורה (קושחה ישנה מ-v2.67)
  });
}

async function notify(b, title, msg, prio, tags) {
  if (!b.topic) return;
  const srv = (b.srv || 'https://ntfy.sh').replace(/\/+$/, '');
  const body = { topic: b.topic, title, message: msg, priority: prio, tags };
  if (b.click) body.click = b.click;
  const r = await fetch(srv, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(`${b.dev}: ntfy ${r.status}`);
}

const now = Date.now();
for (const b of boards) {
  if (!b.host || !b.dev) continue;
  const name = b.name || b.dev;
  const r = await readOnline(b);
  const prev = state[b.dev] || {};
  if (r.err) { console.log(`${b.dev}: ${r.err}`); continue; }      // אין גישה לשרת — לא מסיקים כלום על הלוח
  if (r.v !== '0' && r.v !== '1') { console.log(`${b.dev}: no online message`); continue; }
  console.log(`${b.dev}: online=${r.v} (before: ${prev.v ?? '-'})`);
  if (r.v === '0' && prev.v !== '0') {
    await notify(b, `${name} — הלוח לא מקוון`, 'הלוח התנתק מהשרת: נפילת חשמל, ניתוק רשת או אינטרנט. השלטים לא יעבדו עד שיחזור. כשהוא יחזור תגיע התראה.', 5, ['rotating_light']);
    state[b.dev] = { v: '0', since: now };
  } else if (r.v === '1' && prev.v === '0') {
    const min = prev.since ? Math.round((now - prev.since) / 60000) : null;
    await notify(b, `${name} — הלוח חזר`, `הלוח מחובר שוב${min != null ? ` (בערך ${min} דקות בלי קשר)` : ''}.`, 3, ['white_check_mark']);
    state[b.dev] = { v: '1', since: now };
  } else if (!prev.v) state[b.dev] = { v: r.v, since: now };
}
fs.writeFileSync(STATE, JSON.stringify(state));
