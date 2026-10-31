/* Reads dates, times and the notice type from English and Hinglish text. No network, no AI. */
var DAY = 86400000;
var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
var ENG_WEEK = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
var HI_WEEK = { ravivar: 0, somvar: 1, mangalvar: 2, budhvar: 3, guruvar: 4, shukravar: 5, shanivar: 6 };
var MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
var CAT_IDS = ['exam', 'project', 'syllabus', 'holiday', 'event', 'announcement'];

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function mkDate(y, m, d) {
  var dt = new Date(y, m, d, 12, 0, 0, 0);
  return (dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d) ? dt : null;
}
function fillYear(m, d, y, today) {
  if (y) { if (y < 100) y += 2000; return mkDate(y, m, d); }
  var dt = mkDate(today.getFullYear(), m, d);
  if (dt && (today - dt) / DAY > 45) dt = mkDate(today.getFullYear() + 1, m, d);
  return dt;
}
function weekIdx(w) {
  w = w.toLowerCase();
  if (HI_WEEK[w] !== undefined) return HI_WEEK[w];
  return ENG_WEEK[w.slice(0, 3)];
}

/* Dates and times are read from English and Hinglish messages (kal, parso, baje, ...). */
function findDate(text, today) {
  var cands = [], m, re, dt;

  re = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = re.exec(text))) {
    dt = fillYear(+m[2] - 1, +m[1], m[3] ? +m[3] : 0, today);
    if (dt) cands.push({ i: m.index, d: dt, src: m[0], kind: 'date' });
  }
  re = /\b(\d{1,2})[-.](\d{1,2})[-.](\d{2,4})\b/g;
  while ((m = re.exec(text))) {
    dt = fillYear(+m[2] - 1, +m[1], +m[3], today);
    if (dt) cands.push({ i: m.index, d: dt, src: m[0], kind: 'date' });
  }
  re = new RegExp('\\b(\\d{1,2})(st|nd|rd|th)?\\s*(?:of\\s+)?' + MONTH_RE + '\\b(?:\\s*,?\\s*(\\d{4}))?', 'gi');
  while ((m = re.exec(text))) {
    if (m[3].toLowerCase() === 'may' && !m[2] && m[3].charAt(0) !== 'M') continue;
    dt = fillYear(MONTHS[m[3].toLowerCase().slice(0, 3)], +m[1], m[4] ? +m[4] : 0, today);
    if (dt) cands.push({ i: m.index, d: dt, src: m[0], kind: 'date' });
  }
  re = new RegExp('\\b' + MONTH_RE + '\\.?\\s+(\\d{1,2})(st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4}))?', 'gi');
  while ((m = re.exec(text))) {
    if (m[1].toLowerCase() === 'may' && !m[3] && m[1].charAt(0) !== 'M') continue;
    dt = fillYear(MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2], m[4] ? +m[4] : 0, today);
    if (dt) cands.push({ i: m.index, d: dt, src: m[0], kind: 'date' });
  }
  if (cands.length) {
    cands.sort(function (a, b) { return a.i - b.i; });
    return cands[0];
  }

  var rel = [
    [/\b(day after tomorrow|parso|parson)\b/i, 2],
    [/\b(tomorrow|tmrw|tomorow|kal)\b/i, 1],
    [/\b(today|aaj)\b/i, 0]
  ];
  for (var i = 0; i < rel.length; i++) {
    m = rel[i][0].exec(text);
    if (m) {
      var r = new Date(today.getFullYear(), today.getMonth(), today.getDate() + rel[i][1], 12);
      return { i: m.index, d: r, src: m[0], kind: 'relative' };
    }
  }

  m = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat|ravivar|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar)\b/i.exec(text);
  if (m) {
    var wd = weekIdx(m[1]);
    if (wd !== undefined) {
      var diff = (wd - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      return { i: m.index, d: new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff, 12), src: m[0], kind: 'weekday' };
    }
  }
  return null;
}

function to24(h, min, ap, low) {
  if (min > 59) return null;
  if (ap) {
    ap = ap.toLowerCase();
    if (h < 1 || h > 12) return null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  } else {
    if (h > 23) return null;
    if (h >= 1 && h <= 6) { if (!/(subah|morning)/.test(low)) h += 12; }
    else if (h >= 7 && h <= 11 && /(shaam|evening|raat|night)/.test(low)) h += 12;
  }
  return pad2(h) + ':' + pad2(min);
}

function findTime(text, low) {
  var c = [], m, t;
  var re1 = /(^|[^\d.:\/-])(\d{1,2})[:.](\d{2})\s*(am|pm)?(?!\d|\.\d)/ig;
  while ((m = re1.exec(text))) {
    t = to24(+m[2], +m[3], m[4], low);
    if (t) c.push({ i: m.index, t: t, src: (m[2] + (m[0].indexOf(':') > -1 ? ':' : '.') + m[3] + (m[4] ? ' ' + m[4] : '')) });
  }
  var re2 = /(^|[^\d.:\/-])(\d{1,2})\s*(am|pm)\b/ig;
  while ((m = re2.exec(text))) {
    t = to24(+m[2], 0, m[3], low);
    if (t) c.push({ i: m.index, t: t, src: m[2] + ' ' + m[3] });
  }
  var re3 = /(^|[^\d.:\/-])(\d{1,2})(?:[:.](\d{2}))?\s*baje\b/ig;
  while ((m = re3.exec(text))) {
    t = to24(+m[2], m[3] ? +m[3] : 0, '', low);
    if (t) c.push({ i: m.index, t: t, src: m[2] + (m[3] ? ':' + m[3] : '') + ' baje' });
  }
  if (!c.length) return null;
  c.sort(function (a, b) { return a.i - b.i; });
  return c[0];
}

/* The order matters: the first rule that matches decides the type. */
function pickCat(low) {
  if (/(holiday|chhutti|chutti|vacation|re-?open|diwali|no lectures?|(college|campus|office|library) (is |will be |will remain |remains )?closed)/.test(low)) return 'holiday';
  if (/(submission|submit|assignment|project|journal|record book|ppt|presentation)/.test(low)) return 'project';
  if (/syllabus/.test(low)) return 'syllabus';
  if (/(\bexam|\bpaper\b|\btest\b|practical|\bviva|internal|hall ticket|\bia\b)/.test(low)) return 'exam';
  if (/(\bfest\b|festival|competition|hackathon|seminar|workshop|\bevent\b|webinar|cultural|annual day|sports day|guest lecture)/.test(low)) return 'event';
  if (/(unit\s*\d|module|chapter|\btopics?\b)/.test(low)) return 'syllabus';
  return 'announcement';
}

function pickTitle(raw) {
  var lines = raw.split(/\n+/).map(function (l) { return l.replace(/^[\s*•\-_>#~]+/, '').replace(/[*_~]+/g, '').trim(); }).filter(Boolean);
  var greet = /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening)|attention|notice|important)\b/i;
  var pick = '';
  for (var i = 0; i < lines.length; i++) {
    if (greet.test(lines[i]) && lines[i].length < 35 && lines.length > 1) continue;
    pick = lines[i]; break;
  }
  if (!pick) pick = lines[0] || '';
  return pick.length > 90 ? pick.slice(0, 87) + '...' : pick;
}

function parseNotice(raw, now) {
  var text = raw.replace(/[ \t]+/g, ' ').trim();
  var low = text.toLowerCase();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  var d = findDate(text, today);
  var t = findTime(text, low);
  return {
    title: pickTitle(raw),
    cat: pickCat(low),
    date: d ? keyOf(d.d) : '',
    dateSrc: d ? d.src : '',
    dateKind: d ? d.kind : '',
    time: t ? t.t : '',
    timeSrc: t ? t.src : ''
  };
}

/* Cleans what Claude read from a photo. Every field is checked, nothing is trusted as is. */
function cleanAI(o, now) {
  o = (o && typeof o === 'object') ? o : {};
  var text = typeof o.text === 'string' ? o.text.trim().slice(0, 2000) : '';
  var title = typeof o.title === 'string' ? o.title.trim().slice(0, 120) : '';
  if (!title && text) title = pickTitle(text);
  var date = '', time = '';
  if (typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) {
    var p = o.date.split('-');
    if (mkDate(+p[0], +p[1] - 1, +p[2])) date = o.date;
  }
  if (typeof o.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time)) time = o.time;
  var cat = CAT_IDS.indexOf(o.type) > -1 ? o.type : pickCat((title + ' ' + text).toLowerCase());
  if (text && (!date || !time)) {
    var r = parseNotice(text, now);
    if (!date && r.date && r.dateKind === 'date') date = r.date;
    if (!time && r.time) time = r.time;
  }
  return { title: title, text: text, date: date, time: time, cat: cat };
}

if (typeof module !== 'undefined') module.exports = { parseNotice: parseNotice, pickCat: pickCat, findDate: findDate, findTime: findTime, CAT_IDS: CAT_IDS };
