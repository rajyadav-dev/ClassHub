/* Class Hub. All data lives in Supabase; the database decides who may read or write (see schema.sql). */
(function () {
  'use strict';

  var CFG = window.CLASSHUB_CONFIG || {};
  var AUTH_DOMAIN = CFG.AUTH_DOMAIN || 'example.com';
  var BUCKET = 'attachments';
  var MAX_FILE = 8 * 1024 * 1024;
  var CATS = [['exam', 'Exam'], ['project', 'Project'], ['syllabus', 'Syllabus'], ['holiday', 'Holiday'], ['event', 'Event'], ['announcement', 'Announcement']];
  var CAT_LABEL = {};
  CATS.forEach(function (c) { CAT_LABEL[c[0]] = c[1]; });
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DEFAULT_ROLL = /^[A-Z]{4}[0-9]{3}[A-Z]$/;

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var sb = null;
  var st = {
    user: null, profile: null, classes: [], view: null,
    notices: [], notes: [], people: [], counts: null,
    filter: 'all', tab: '', search: '',
    allowed: [], att: null, noteFile: null, channel: null, lastSeen: 0, door: 'student', greeted: false
  };

  /* ---------- small helpers ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function friendly(e) {
    var m = (e && (e.message || e.error_description || e.msg)) || String(e || 'Something went wrong');
    if (/row-level security|permission denied|not_allowed/i.test(m)) return 'You do not have permission to do that.';
    if (/failed to fetch|networkerror|load failed|network request/i.test(m)) return 'No internet connection. Please try again.';
    if (/bad_code/.test(m)) return 'Wrong class code. Ask your CR.';
    if (/bad_roll/.test(m)) return 'This roll number does not match the format for this class.';
    if (/bad_name/.test(m)) return 'Enter your name.';
    if (/already_joined/.test(m)) return 'You have already joined a class.';
    if (/profiles_roll_key|duplicate key/.test(m)) return 'This roll number is already registered. Please log in instead.';
    if (/not_found/.test(m)) return 'Person not found.';
    return m;
  }
  var SIGNUP_MSG = {
    bad_code: 'Wrong class code. Ask your CR.',
    bad_roll: 'The roll number must be 4 letters, 3 digits and 1 letter, like FDAI071A.',
    closed: 'Sign ups are closed for this class. Ask your CR.',
    not_allowed: 'This roll number is not on the class list. Check the number, or ask your CR.'
  };
  function joinMsg(e) {
    var m = (e && e.message) || '';
    if (/not_allowed/.test(m)) return SIGNUP_MSG.not_allowed;
    if (/\bclosed\b/.test(m)) return SIGNUP_MSG.closed;
    return friendly(e);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dateOf(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function nowNoon() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12); }
  function daysFrom(key) { return Math.round((dateOf(key) - nowNoon()) / 86400000); }
  function fmtTime(t) {
    if (!t) return '';
    var p = t.split(':'), h = +p[0], ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + p[1] + ' ' + ap;
  }
  function fmtDate(key) { var d = dateOf(key); return WD[d.getDay()] + ', ' + d.getDate() + ' ' + MN[d.getMonth()]; }
  function seenText(iso) {
    if (!iso) return 'Never opened the app';
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 5) return 'Active just now';
    if (mins < 60) return 'Active ' + mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return 'Active ' + hrs + ' h ago';
    var days = Math.round(hrs / 24);
    return days === 1 ? 'Active yesterday' : 'Active ' + days + ' days ago';
  }
  function cleanRoll(v) { return String(v || '').toUpperCase().replace(/\s+/g, ''); }
  function rollToEmail(roll) { return cleanRoll(roll).toLowerCase() + '@' + AUTH_DOMAIN; }
  function show(id, on) { $(id).hidden = !on; }
  function setBusy(btn, busy, label) { btn.disabled = busy; if (label) btn.textContent = label; }

  function role() { return st.profile ? st.profile.role : 'student'; }
  function isAdmin() { return role() === 'admin'; }
  function canWrite() { return role() === 'admin' || role() === 'editor'; }
  function classById(id) { for (var i = 0; i < st.classes.length; i++) if (st.classes[i].id === id) return st.classes[i]; return null; }
  function className(id) { var c = classById(id); return c ? c.name : 'Unknown class'; }

  /* ---------- start ---------- */
  function fatal(msg) {
    ['splash', 'welcome', 'gate', 'app', 'joinBox'].forEach(function (i) { show(i, false); });
    $('fatal').textContent = msg; $('fatal').hidden = false;
  }

  function boot() {
    var url = CFG.SUPABASE_URL || '', key = CFG.SUPABASE_ANON_KEY || '';
    if (!url || !key || /YOUR/i.test(url) || /YOUR/i.test(key)) {
      fatal('The app is not connected to its database yet. Open config.js and paste your Supabase URL and anon key (see SETUP.md).');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      fatal('Could not load the app files. Check your internet connection and reload.');
      return;
    }
    sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    sb.auth.getSession().then(function (r) {
      if (r && r.data && r.data.session) return afterLogin(r.data.session.user);
      showWelcome();
    }).catch(function (e) { fatal(friendly(e)); });
  }

  /* ---------- welcome: two doors, plus a hidden admin door (tap the logo 5 times) ---------- */
  function showWelcome() {
    st.user = null; st.profile = null;
    ['splash', 'gate', 'app', 'joinBox'].forEach(function (i) { show(i, false); });
    show('welcome', true);
    window.scrollTo(0, 0);
  }
  var DOORS = {
    student: { cls: 'm-student', icon: '#i-cap', title: 'ClassMate Login', sub: 'Log in or sign up with your roll number', note: 'Only registered students can access the portal.' },
    cr: { cls: 'm-cr', icon: '#i-users', title: 'CR Login', sub: 'Log in to post notices and notes', note: 'Only authorised CRs can post. New CR? Sign up first, then ask the admin.' },
    admin: { cls: 'm-admin', icon: '#i-shield', title: 'Admin Login', sub: 'Authorised access only', note: 'Secure · Private · ClassHub' }
  };
  function showGate(door) {
    door = DOORS[door] ? door : (st.door || 'student'); st.door = door;
    var d = DOORS[door];
    st.user = null; st.profile = null;
    ['splash', 'app', 'joinBox', 'welcome'].forEach(function (i) { show(i, false); });
    show('gate', true);
    $('gate').className = 'auth ' + d.cls;
    $('gateIcon').setAttribute('href', d.icon);
    $('gateTitle').textContent = d.title; $('gateSub').textContent = d.sub; $('gateNote').textContent = d.note;
    show('segBox', door !== 'admin'); show('upCallout', door === 'cr');
    setSeg(true);
    $('inErr').textContent = ''; $('upErr').textContent = '';
    window.scrollTo(0, 0);
  }
  $('doorCr').addEventListener('click', function () { showGate('cr'); });
  $('doorStudent').addEventListener('click', function () { showGate('student'); });
  $('backBtn').addEventListener('click', showWelcome);
  var logoTaps = 0, logoTimer = null;
  $('logoTap').addEventListener('click', function () {
    logoTaps++; clearTimeout(logoTimer); logoTimer = setTimeout(function () { logoTaps = 0; }, 1800);
    if (logoTaps >= 5) { logoTaps = 0; showGate('admin'); }
  });

  async function rejectLogin(door, msg) {
    try { await sb.auth.signOut(); } catch (e) {}
    showGate(door); $('inErr').textContent = msg;
  }

  /* mode = which door the person used (only set on a real log in); the database still decides what they can do */
  async function afterLogin(user, mode) {
    st.user = user;
    var r = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (r.error) { fatal(friendly(r.error)); return; }
    if (!r.data) { showJoin(); return; }
    st.profile = r.data;
    if (mode === 'cr' && !canWrite()) { return rejectLogin('cr', 'This account is not a CR yet. Ask the admin to make you a CR, or use the ClassMate door.'); }
    if (mode === 'admin' && !isAdmin()) { return rejectLogin('admin', 'This account is not an admin.'); }
    var c = await sb.from('classes').select('*').order('name');
    if (c.error) { fatal(friendly(c.error)); return; }
    st.classes = c.data || [];
    var saved = lsGet('classHub.view');
    st.view = (isAdmin() && saved && classById(saved)) ? saved : st.profile.class_id;
    enterApp();
  }

  function showJoin() {
    ['splash', 'gate', 'app', 'welcome'].forEach(function (i) { show(i, false); });
    show('joinBox', true);
    $('joinRoll').textContent = (st.user.email || '').split('@')[0].toUpperCase();
  }

  function enterApp() {
    ['splash', 'gate', 'joinBox', 'welcome'].forEach(function (i) { show(i, false); });
    show('app', true);
    show('composeBox', canWrite());
    show('noteBox', canWrite());
    show('tab-people', canWrite());
    show('classForm', isAdmin());
    st.greeted = false;
    buildClassBar();
    buildTargets();
    renderProfile();
    route();
    refresh();
    subscribe();
    touchSeen(true);
  }

  /* ---------- login / sign up ---------- */
  function setSeg(login) {
    $('segIn').setAttribute('aria-pressed', login ? 'true' : 'false');
    $('segUp').setAttribute('aria-pressed', login ? 'false' : 'true');
    $('inForm').hidden = !login; $('upForm').hidden = login;
  }
  $('segIn').addEventListener('click', function () { setSeg(true); });
  $('segUp').addEventListener('click', function () { setSeg(false); });
  ['inRoll', 'upRoll'].forEach(function (id) {
    $(id).addEventListener('input', function () { var v = cleanRoll($(id).value); if (v !== $(id).value) $(id).value = v; });
  });
  ['inPin', 'upPin', 'upPin2'].forEach(function (id) {
    $(id).addEventListener('input', function () { var v = $(id).value.replace(/\D/g, ''); if (v !== $(id).value) $(id).value = v; });
  });
  $('upCode').addEventListener('input', function () { $('upCode').value = $('upCode').value.toUpperCase().replace(/\s+/g, ''); });
  $('joCode').addEventListener('input', function () { $('joCode').value = $('joCode').value.toUpperCase().replace(/\s+/g, ''); });

  $('inForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var roll = cleanRoll($('inRoll').value), pin = $('inPin').value, err = $('inErr');
    if (!roll) { err.textContent = 'Enter your roll number.'; return; }
    if (!/^\d{6}$/.test(pin)) { err.textContent = 'Your PIN is 6 digits.'; return; }
    err.textContent = ''; setBusy($('inBtn'), true, 'Logging in...');
    try {
      var r = await sb.auth.signInWithPassword({ email: rollToEmail(roll), password: pin });
      if (r.error) {
        err.textContent = /invalid login/i.test(r.error.message) ? 'Wrong roll number or PIN. If you have not signed up yet, use Sign up.' : friendly(r.error);
        return;
      }
      $('inPin').value = '';
      await afterLogin(r.data.user, st.door);
    } catch (e) { err.textContent = friendly(e); }
    finally { setBusy($('inBtn'), false, 'Log in'); }
  });

  $('upForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var err = $('upErr');
    var code = $('upCode').value.trim().toUpperCase(), name = $('upName').value.trim(), roll = cleanRoll($('upRoll').value);
    var pin = $('upPin').value, pin2 = $('upPin2').value;
    if (!code) { err.textContent = 'Enter the class code.'; return; }
    if (!name) { err.textContent = 'Enter your name.'; return; }
    if (!roll) { err.textContent = 'Enter your roll number.'; return; }
    if (!/^\d{6}$/.test(pin)) { err.textContent = 'Your PIN must be exactly 6 digits.'; return; }
    if (pin !== pin2) { err.textContent = 'The two PINs do not match.'; return; }
    err.textContent = ''; setBusy($('upBtn'), true, 'Creating account...');
    try {
      var chk = await sb.rpc('check_class_code', { p_code: code });
      if (chk.error) { err.textContent = friendly(chk.error); return; }
      if (!chk.data || !chk.data.length) { err.textContent = 'Wrong class code. Ask your CR.'; return; }
      var re = DEFAULT_ROLL;
      try { re = new RegExp(chk.data[0].roll_regex); } catch (e2) {}
      if (!re.test(roll)) { err.textContent = 'The roll number must be 4 letters, 3 digits and 1 letter, like FDAI071A.'; return; }
      var cs = await sb.rpc('check_signup', { p_code: code, p_roll: roll });
      if (cs.error) { if (!/could not find|does not exist|PGRST202|schema cache/i.test(cs.error.message || '')) { err.textContent = friendly(cs.error); return; } }
      else if (cs.data !== 'ok') { err.textContent = SIGNUP_MSG[cs.data] || 'This roll number cannot sign up right now.'; return; }
      var su = await sb.auth.signUp({ email: rollToEmail(roll), password: pin });
      if (su.error) {
        err.textContent = /already registered|already been registered/i.test(su.error.message)
          ? 'This roll number already has an account. Use Log in. If you forgot the PIN, ask your admin.'
          : friendly(su.error);
        return;
      }
      if (!su.data.session) {
        err.textContent = 'Account created, but the database still wants email confirmation. The admin must turn it off (see SETUP.md).';
        return;
      }
      var j = await sb.rpc('join_class', { p_code: code, p_name: name, p_roll: roll });
      if (j.error) {
        err.textContent = joinMsg(j.error);
        await sb.auth.signOut();
        return;
      }
      $('upPin').value = ''; $('upPin2').value = '';
      await afterLogin(su.data.user, st.door);
    } catch (e) { err.textContent = friendly(e); }
    finally { setBusy($('upBtn'), false, 'Sign up'); }
  });

  $('joinForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var err = $('joErr'), code = $('joCode').value.trim().toUpperCase(), name = $('joName').value.trim();
    var roll = (st.user.email || '').split('@')[0].toUpperCase();
    if (!code || !name) { err.textContent = 'Enter the class code and your name.'; return; }
    err.textContent = '';
    var j = await sb.rpc('join_class', { p_code: code, p_name: name, p_roll: roll });
    if (j.error) { err.textContent = joinMsg(j.error); return; }
    await afterLogin(st.user);
  });

  $('logout').addEventListener('click', async function () {
    try { if (st.channel) sb.removeChannel(st.channel); } catch (e) {}
    st.channel = null;
    try { await sb.auth.signOut(); } catch (e) {}
    st.notices = []; st.notes = []; st.people = []; st.att = null;
    clearAtt(); location.hash = '';
    showWelcome();
  });

  /* ---------- tabs and class switcher ---------- */
  var TABS = ['home', 'notices', 'notes', 'people', 'profile'];
  function route() {
    var h = location.hash.replace('#', '');
    if (TABS.indexOf(h) < 0) h = 'home';
    if (h === 'people' && !canWrite()) h = 'home';
    var changed = st.tab !== h;
    st.tab = h;
    TABS.forEach(function (t) {
      show('view' + t.charAt(0).toUpperCase() + t.slice(1), h === t);
      $('tab-' + t).setAttribute('aria-current', h === t ? 'page' : 'false');
    });
    if (changed) window.scrollTo(0, 0);
    if (h === 'people' && st.profile) loadPeople();
  }
  window.addEventListener('hashchange', route);

  function buildClassBar() {
    var sel = $('classSel'); sel.textContent = '';
    st.classes.forEach(function (c) { var o = el('option', '', c.name); o.value = c.id; sel.appendChild(o); });
    sel.value = st.view;
    show('classBar', isAdmin() && st.classes.length > 1);
    renderHome();
  }
  $('classSel').addEventListener('change', function () {
    st.view = $('classSel').value; lsSet('classHub.view', st.view);
    buildTargets(); refresh(); renderHome();
  });

  /* ---------- theme ---------- */
  function applyTheme(t) {
    var r = document.documentElement;
    if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else { t = 'auto'; r.removeAttribute('data-theme'); }
    [['thAuto', 'auto'], ['thLight', 'light'], ['thDark', 'dark']].forEach(function (p) { $(p[0]).setAttribute('aria-pressed', t === p[1] ? 'true' : 'false'); });
    lsSet('classHub.theme', t);
  }
  $('thAuto').addEventListener('click', function () { applyTheme('auto'); });
  $('thLight').addEventListener('click', function () { applyTheme('light'); });
  $('thDark').addEventListener('click', function () { applyTheme('dark'); });
  applyTheme(lsGet('classHub.theme') || 'auto');

  /* ---------- home: greeting, numbers, what is coming up ---------- */
  function initial(name) { return (String(name || '?').trim().charAt(0) || '?').toUpperCase(); }
  function icon(id) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic');
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id);
    s.appendChild(u); return s;
  }
  function dueSoon() {
    return st.notices.filter(function (n) { if (!n.notice_date) return false; var d = daysFrom(n.notice_date); return d >= 0 && d <= 3; }).sort(byWhen);
  }
  function whenText(d) { return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'In ' + d + ' days'; }
  function drow(n, pillText, hot) {
    var r = el('div', 'drow'); r.style.setProperty('--cc', 'var(--c-' + catOf(n) + ')');
    var t = el('div', 't', n.title);
    var meta = [CAT_LABEL[catOf(n)]];
    if (n.notice_date) meta.push(fmtDate(n.notice_date));
    if (n.notice_time) meta.push(fmtTime(n.notice_time.slice(0, 5)));
    t.appendChild(el('div', 'm', meta.join(' · ')));
    r.appendChild(t);
    if (pillText) r.appendChild(el('span', 'pill' + (hot ? ' hot' : ''), pillText));
    r.style.cursor = 'pointer';
    r.addEventListener('click', function () { location.hash = '#notices'; });
    return r;
  }
  function renderHome() {
    if (!st.profile) return;
    var hr = new Date().getHours();
    $('gHi').textContent = hr < 12 ? 'Good morning,' : hr < 17 ? 'Good afternoon,' : 'Good evening,';
    $('gName').textContent = st.profile.name;
    $('gClass').textContent = className(st.view);
    $('gAv').textContent = initial(st.profile.name);
    var soon = dueSoon(), subjects = {};
    st.notes.forEach(function (n) { subjects[n.subject] = 1; });
    var box = $('homeStats'); box.textContent = '';
    [[st.notices.length, 'Notices', '', '#notices'], [soon.length, 'Due soon', soon.length ? 'warn' : '', '#home'], [st.notes.length, 'Notes', '', '#notes'], [Object.keys(subjects).length, 'Subjects', '', '#notes']].forEach(function (s) {
      var t = el('a', 'stile' + (s[2] ? ' ' + s[2] : '')); t.href = s[3];
      t.appendChild(el('div', 'n', String(s[0]))); t.appendChild(el('div', 'l', s[1]));
      if (s[3] === '#home') t.addEventListener('click', function (ev) { ev.preventDefault(); var w = $('dueWrap'); if (w && w.scrollIntoView) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      box.appendChild(t);
    });
    var bb = $('bellBadge'); bb.textContent = String(soon.length); bb.hidden = !soon.length;
    var dl = $('dueList'); dl.textContent = '';
    if (!soon.length) {
      var ok = el('div', 'allclear'); ok.appendChild(icon('i-check')); ok.appendChild(el('span', '', 'Nothing due in the next 3 days.')); dl.appendChild(ok);
    } else soon.forEach(function (n) { var d = daysFrom(n.notice_date); dl.appendChild(drow(n, whenText(d), d <= 1)); });
    var ll = $('latestList'); ll.textContent = '';
    var latest = st.notices.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).slice(0, 3);
    if (!latest.length) ll.appendChild(el('p', 'empty', 'No notices yet.'));
    latest.forEach(function (n) { ll.appendChild(drow(n, '', false)); });
  }
  $('bell').addEventListener('click', function () {
    location.hash = '#home';
    setTimeout(function () { var w = $('dueWrap'); if (w && w.scrollIntoView) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  });
  function renderProfile() {
    if (!st.profile) return;
    $('pAv').textContent = initial(st.profile.name);
    $('pName').textContent = st.profile.name;
    var rl = $('pRole'); rl.textContent = isAdmin() ? 'Admin' : role() === 'editor' ? 'CR' : 'Student'; rl.className = 'chip r-' + role();
    $('pRoll').textContent = st.profile.roll;
    $('pClass').textContent = className(st.profile.class_id);
  }

  function buildTargets() {
    show('targetField', isAdmin());
    var sel = $('nTarget'); sel.textContent = '';
    var o = el('option', '', className(st.view)); o.value = st.view; sel.appendChild(o);
    if (isAdmin()) { var all = el('option', '', 'Whole college (all classes)'); all.value = 'college'; sel.appendChild(all); }
  }

  /* ---------- loading data ---------- */
  var refreshing = false, again = false;
  async function refresh() {
    if (!st.profile) return;
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      var n = await sb.from('notices').select('*').or('class_id.is.null,class_id.eq.' + st.view).order('created_at', { ascending: false }).limit(300);
      var m = await sb.from('notes').select('*').eq('class_id', st.view).order('created_at', { ascending: false }).limit(300);
      if (n.error) throw n.error;
      if (m.error) throw m.error;
      st.notices = n.data || []; st.notes = m.data || [];
      $('foot').textContent = 'Class Hub · updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      renderNotices(); renderNotes(); renderHome();
      if (!st.greeted) {
        st.greeted = true;
        var tm = st.notices.filter(function (x) { return x.notice_date && daysFrom(x.notice_date) === 1; }).length;
        var td = st.notices.filter(function (x) { return x.notice_date && daysFrom(x.notice_date) === 0; }).length;
        if (tm || td) toast((td ? td + ' due today' : '') + (td && tm ? ' · ' : '') + (tm ? tm + ' due tomorrow' : ''));
      }
      if (st.tab === 'people') loadPeople();
    } catch (e) { toast(friendly(e)); }
    finally { refreshing = false; if (again) { again = false; refresh(); } }
  }

  var subTimer = null;
  function subscribe() {
    if (st.channel) return;
    try {
      st.channel = sb.channel('classhub-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, soon)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, soon)
        .subscribe();
    } catch (e) {}
  }
  function soon() { clearTimeout(subTimer); subTimer = setTimeout(refresh, 400); }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && st.profile) { refresh(); touchSeen(false); }
  });
  function touchSeen(force) {
    var now = Date.now();
    if (!force && now - st.lastSeen < 5 * 60000) return;
    st.lastSeen = now;
    try { sb.rpc('touch_seen').then(function () {}, function () {}); } catch (e) {}
  }

  /* ---------- attachments ---------- */
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        c.toBlob(function (b) { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('Could not read this photo.')); }, 'image/jpeg', 0.78);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read this photo.')); };
      im.src = url;
    });
  }
  function clearAtt() {
    if (st.att && st.att.preview) URL.revokeObjectURL(st.att.preview);
    st.att = null; show('attBox', false); show('attPrev', false); show('attPdf', false);
    ['camInput', 'galInput', 'pdfInput'].forEach(function (id) { $(id).value = ''; });
  }
  async function pickAtt(file, kind) {
    if (!file) return;
    $('nErr').textContent = '';
    try {
      var blob, ext, type;
      if (kind === 'pdf') {
        if (file.size > MAX_FILE) { $('nErr').textContent = 'This PDF is bigger than 8 MB. Put it on Google Drive and paste the link in a note instead.'; clearAtt(); return; }
        blob = file; ext = 'pdf'; type = 'application/pdf';
      } else {
        blob = await shrinkImage(file); ext = 'jpg'; type = 'image/jpeg';
      }
      clearAtt();
      st.att = { kind: kind, blob: blob, ext: ext, type: type, name: file.name || (kind === 'pdf' ? 'notice.pdf' : 'photo.jpg'), preview: kind === 'image' ? URL.createObjectURL(blob) : '' };
      show('attBox', true);
      if (kind === 'image') { $('attPrev').src = st.att.preview; show('attPrev', true); show('attPdf', false); }
      else { show('attPrev', false); show('attPdf', true); }
      $('attName').textContent = st.att.name + ' (' + Math.max(1, Math.round(blob.size / 1024)) + ' KB)';
    } catch (e) { $('nErr').textContent = friendly(e); }
  }
  $('camInput').addEventListener('change', function () { pickAtt($('camInput').files[0], 'image'); });
  $('galInput').addEventListener('change', function () { pickAtt($('galInput').files[0], 'image'); });
  $('pdfInput').addEventListener('change', function () { pickAtt($('pdfInput').files[0], 'pdf'); });
  $('attRemove').addEventListener('click', clearAtt);

  async function upload(folder, blob, ext, type) {
    var path = folder + '/' + uuid() + '.' + ext;
    var r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (r.error) throw r.error;
    return path;
  }
  function removeFile(path) { if (path) { try { sb.storage.from(BUCKET).remove([path]).then(function () {}, function () {}); } catch (e) {} } }

  async function openAttachment(path, kind, title) {
    try {
      var r = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (r.error) throw r.error;
      var url = r.data.signedUrl;
      var img = $('lbImg'), open = $('lbOpen');
      img.hidden = true; open.hidden = true;
      if (kind === 'image') { img.src = url; img.alt = title || 'Notice photo'; img.hidden = false; }
      else { open.href = url; open.hidden = false; }
      $('lightbox').hidden = false;
    } catch (e) { toast(friendly(e)); }
  }
  $('lbClose').addEventListener('click', function () { $('lightbox').hidden = true; $('lbImg').removeAttribute('src'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('lbClose').click(); });

  /* ---------- notices: compose ---------- */
  CATS.forEach(function (c) { var o = el('option', '', c[1]); o.value = c[0]; $('nCat').appendChild(o); });
  $('nCat').value = 'announcement';

  $('parseBtn').addEventListener('click', function () {
    var raw = $('pasteBox').value.trim(), box = $('understood');
    if (!raw) { box.textContent = 'Paste the message first.'; box.hidden = false; return; }
    var r = parseNotice(raw, new Date());
    $('nTitle').value = r.title; $('nCat').value = r.cat; $('nDate').value = r.date; $('nTime').value = r.time;
    var bits = ['Type: ' + CAT_LABEL[r.cat]];
    bits.push(r.date ? 'Date: ' + fmtDate(r.date) + ' (from "' + r.dateSrc + '")' : 'No date found');
    if (r.time) bits.push('Time: ' + fmtTime(r.time));
    box.textContent = bits.join(' · ') + '. Please check before posting.'; box.hidden = false;
  });
  function clearComposer() {
    $('composer').reset(); $('nCat').value = 'announcement'; clearAtt();
    $('understood').hidden = true; $('nErr').textContent = '';
  }
  $('nClear').addEventListener('click', clearComposer);

  $('composer').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!canWrite()) return;
    var err = $('nErr'), title = $('nTitle').value.trim(), body = $('pasteBox').value.trim();
    if (!title) {
      if (body) { title = pickTitle(body); $('nTitle').value = title; }
      if (!title) { err.textContent = 'Add a title (or paste the message and tap the fill button).'; $('nTitle').focus(); return; }
    }
    var target = isAdmin() && $('nTarget').value === 'college' ? null : st.view;
    err.textContent = ''; setBusy($('nBtn'), true, 'Posting...');
    var path = null;
    try {
      if (st.att) path = await upload(target || 'college', st.att.blob, st.att.ext, st.att.type);
      var row = {
        class_id: target, title: title.slice(0, 120), body: body.slice(0, 4000), cat: $('nCat').value,
        notice_date: $('nDate').value || null, notice_time: $('nTime').value || null,
        unconfirmed: $('nUnconf').checked, attachment_path: path, attachment_kind: st.att ? st.att.kind : null,
        author_id: st.user.id, author_name: st.profile.name
      };
      var r = await sb.from('notices').insert(row);
      if (r.error) { removeFile(path); throw r.error; }
      clearComposer(); toast('Notice posted'); await refresh();
    } catch (e) { err.textContent = friendly(e); }
    finally { setBusy($('nBtn'), false, 'Post notice'); }
  });

  /* ---------- notices: list ---------- */
  var GROUPS = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['later', 'Later'], ['none', 'No date']];
  function groupOf(n) {
    if (!n.notice_date) return 'none';
    var d = daysFrom(n.notice_date);
    if (d < 0) return 'past'; if (d === 0) return 'today'; if (d === 1) return 'tomorrow'; if (d <= 7) return 'week';
    return 'later';
  }
  function catOf(n) { return CAT_LABEL[n.cat] ? n.cat : 'announcement'; }
  function tile(n) {
    var t = el('div', 'tile');
    if (!n.notice_date) { t.className = 'tile none'; t.appendChild(el('div', 'd', '--')); t.appendChild(el('div', 'm', 'No')); t.appendChild(el('div', 'w', 'date')); return t; }
    var d = dateOf(n.notice_date), diff = daysFrom(n.notice_date);
    if (diff === 0 || diff === 1) t.className = 'tile hot';
    t.appendChild(el('div', 'd', String(d.getDate())));
    t.appendChild(el('div', 'm', MN[d.getMonth()]));
    t.appendChild(el('div', 'w', diff === 0 ? 'Today' : diff === 1 ? 'Tmrw' : WD[d.getDay()]));
    return t;
  }
  function delBtn(label, onConfirm, text) {
    var base = text || '×';
    var b = el('button', 'del', base); b.type = 'button'; b.setAttribute('aria-label', label);
    var armed = false, t = null;
    b.addEventListener('click', function () {
      if (!armed) {
        armed = true; b.textContent = 'Sure?'; b.className = 'del armed';
        t = setTimeout(function () { armed = false; b.textContent = base; b.className = 'del'; }, 3000);
        return;
      }
      clearTimeout(t); onConfirm();
    });
    return b;
  }
  function noticeItem(n) {
    var li = el('div', 'nitem');
    li.appendChild(tile(n));
    var b = el('div', 'nbody');
    var chips = el('div', 'chips');
    chips.appendChild(el('span', 'chip ' + catOf(n), CAT_LABEL[catOf(n)]));
    if (n.unconfirmed) chips.appendChild(el('span', 'chip warn', 'Not confirmed'));
    if (!n.class_id) chips.appendChild(el('span', 'chip ex', 'Whole college'));
    b.appendChild(chips);
    b.appendChild(el('div', 'title', n.title));
    var meta = [];
    if (n.notice_date) meta.push(fmtDate(n.notice_date));
    if (n.notice_time) meta.push(fmtTime(n.notice_time.slice(0, 5)));
    meta.push('Posted by ' + n.author_name);
    b.appendChild(el('div', 'meta', meta.join(' · ')));
    if (n.attachment_path) {
      var isPdf = n.attachment_kind === 'pdf';
      var ab = el('button', 'attlink', isPdf ? 'Open PDF' : 'View photo'); ab.type = 'button';
      ab.addEventListener('click', function () { openAttachment(n.attachment_path, n.attachment_kind, n.title); });
      b.appendChild(ab);
    }
    if (n.body && n.body.trim() && n.body.trim() !== n.title.trim()) {
      var det = el('details'); det.appendChild(el('summary', '', 'Full message'));
      det.appendChild(el('p', '', n.body)); b.appendChild(det);
    }
    li.appendChild(b);
    var mine = canWrite() && (isAdmin() || n.class_id === st.profile.class_id);
    if (mine) {
      li.appendChild(delBtn('Delete ' + n.title, async function () {
        var r = await sb.from('notices').delete().eq('id', n.id);
        if (r.error) { toast(friendly(r.error)); return; }
        removeFile(n.attachment_path); await refresh();
      }));
    } else li.appendChild(el('span'));
    return li;
  }
  function byWhen(a, b) {
    if (a.notice_date !== b.notice_date) return a.notice_date < b.notice_date ? -1 : 1;
    return (a.notice_time || '') < (b.notice_time || '') ? -1 : 1;
  }
  function renderFilters() {
    var box = $('filters'); box.textContent = '';
    [['all', 'All']].concat(CATS).forEach(function (f) {
      var b = el('button', '', f[1]); b.type = 'button'; b.setAttribute('aria-pressed', st.filter === f[0] ? 'true' : 'false');
      b.addEventListener('click', function () { st.filter = f[0]; renderNotices(); });
      box.appendChild(b);
    });
  }
  function renderNotices() {
    renderFilters();
    var list = st.notices.filter(function (n) { return st.filter === 'all' || catOf(n) === st.filter; });
    var box = $('sections'); box.textContent = '';
    var shown = 0;
    GROUPS.forEach(function (g) {
      var items = list.filter(function (n) { return groupOf(n) === g[0]; }).sort(g[0] === 'none' ? function (a, b) { return a.created_at < b.created_at ? 1 : -1; } : byWhen);
      if (!items.length) return;
      shown += items.length;
      var sec = el('div', 'section'); sec.appendChild(el('h3', '', g[1]));
      items.forEach(function (n) { sec.appendChild(noticeItem(n)); });
      box.appendChild(sec);
    });
    var past = list.filter(function (n) { return groupOf(n) === 'past'; }).sort(function (a, b) { return -byWhen(a, b); });
    if (past.length) {
      shown += past.length;
      var det = el('details', 'past'); det.appendChild(el('summary', '', 'Past notices (' + past.length + ')'));
      var inner = el('div', 'stack'); inner.style.marginTop = '8px';
      past.forEach(function (n) { inner.appendChild(noticeItem(n)); });
      det.appendChild(inner); box.appendChild(det);
    }
    if (!shown) box.appendChild(el('p', 'empty', canWrite() ? 'No notices yet. Post the first one above.' : 'No notices yet. They will appear here as soon as your CR posts them.'));
  }

  /* ---------- notes ---------- */
  $('ntFile').addEventListener('change', function () {
    var f = $('ntFile').files[0], err = $('ntErr');
    if (!f) { st.noteFile = null; $('ntFileName').textContent = ''; return; }
    if (f.size > MAX_FILE) { err.textContent = 'This PDF is bigger than 8 MB. Put it on Google Drive and paste the link instead.'; $('ntFile').value = ''; return; }
    err.textContent = ''; st.noteFile = f; $('ntFileName').textContent = f.name + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)';
  });
  $('noteForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!canWrite()) return;
    var err = $('ntErr'), title = $('ntTitle').value.trim(), subj = $('ntSubj').value.trim(), link = $('ntLink').value.trim();
    if (!title || !subj) { err.textContent = 'Enter a title and a subject.'; return; }
    if (!link && !st.noteFile) { err.textContent = 'Add a Google Drive link or upload a PDF.'; return; }
    if (link && !/^https?:\/\//i.test(link)) { err.textContent = 'The link must start with https://'; return; }
    err.textContent = ''; setBusy($('ntBtn'), true, 'Adding...');
    var path = null;
    try {
      if (st.noteFile) path = await upload(st.view, st.noteFile, 'pdf', 'application/pdf');
      var r = await sb.from('notes').insert({
        class_id: st.view, title: title.slice(0, 80), subject: subj.slice(0, 40), link: link || null,
        attachment_path: path, author_id: st.user.id, author_name: st.profile.name
      });
      if (r.error) { removeFile(path); throw r.error; }
      $('noteForm').reset(); st.noteFile = null; $('ntFileName').textContent = '';
      toast('Note added'); await refresh();
    } catch (e) { err.textContent = friendly(e); }
    finally { setBusy($('ntBtn'), false, 'Add note'); }
  });
  function renderNotes() {
    var box = $('notesList'); box.textContent = '';
    if (!st.notes.length) { box.appendChild(el('p', 'empty', canWrite() ? 'No notes yet. Add the first one above.' : 'No notes yet.')); return; }
    var bySubj = {};
    st.notes.forEach(function (n) { (bySubj[n.subject] = bySubj[n.subject] || []).push(n); });
    Object.keys(bySubj).sort().forEach(function (s) {
      var sec = el('div', 'section'); sec.appendChild(el('h3', '', s));
      bySubj[s].forEach(function (n) {
        var row = el('div', 'noterow');
        var t = el('div', 't', n.title);
        t.appendChild(el('div', 'sub', 'Added by ' + n.author_name));
        row.appendChild(t);
        var acts = el('div', 'btnrow');
        if (n.link) { var a = el('a', '', 'Open link'); a.href = n.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; acts.appendChild(a); }
        if (n.attachment_path) {
          var pb = el('button', 'linkbtn', 'Open PDF'); pb.type = 'button';
          pb.addEventListener('click', function () { openAttachment(n.attachment_path, 'pdf', n.title); });
          acts.appendChild(pb);
        }
        if (canWrite() && (isAdmin() || n.class_id === st.profile.class_id)) {
          acts.appendChild(delBtn('Delete ' + n.title, async function () {
            var r = await sb.from('notes').delete().eq('id', n.id);
            if (r.error) { toast(friendly(r.error)); return; }
            removeFile(n.attachment_path); await refresh();
          }));
        }
        row.appendChild(acts);
        sec.appendChild(row);
      });
      box.appendChild(sec);
    });
  }

  /* ---------- people (CR sees own class, admin sees everyone) ---------- */
  async function loadPeople() {
    try {
      var p = await sb.from('profiles').select('id,name,roll,role,class_id,created_at,last_seen').order('name').limit(2000);
      if (p.error) throw p.error;
      st.people = p.data || [];
      if (isAdmin()) {
        var n = await sb.from('notices').select('class_id').limit(5000);
        var m = await sb.from('notes').select('class_id').limit(5000);
        st.counts = { notices: n.data || [], notes: m.data || [] };
        var ar = await sb.from('allowed_rolls').select('roll').eq('class_id', st.view).limit(2000);
        st.allowed = ar.error ? [] : (ar.data || []);
      }
      renderPeople();
    } catch (e) { toast(friendly(e)); }
  }
  function countBy(rows, cid) { var c = 0; for (var i = 0; i < rows.length; i++) if (rows[i].class_id === cid) c++; return c; }

  function renderPeople() {
    renderRollCard();
    var stats = $('stats'); stats.textContent = '';
    function stat(n, l) { var d = el('div', 'stat'); d.appendChild(el('div', 'n', String(n))); d.appendChild(el('div', 'l', l)); stats.appendChild(d); }
    var scope = isAdmin() ? st.people : st.people.filter(function (x) { return x.class_id === st.profile.class_id; });
    var week = Date.now() - 7 * 86400000;
    var active = scope.filter(function (x) { return x.last_seen && new Date(x.last_seen).getTime() > week; }).length;
    stat(scope.length, 'People joined');
    stat(active, 'Active in last 7 days');
    stat(scope.filter(function (x) { return x.role === 'editor'; }).length, 'CRs');
    if (isAdmin() && st.counts) { stat(st.classes.length, 'Classes'); stat(st.counts.notices.length, 'Notices'); stat(st.counts.notes.length, 'Notes'); }

    var cc = $('classCards'); cc.textContent = '';
    if (isAdmin()) {
      cc.appendChild(el('h3', '', 'Classes'));
      st.classes.forEach(function (c) {
        var card = el('div', 'ccard');
        var l = el('div'); l.appendChild(el('div', '', c.name)); l.style.fontWeight = '600';
        var joined = st.people.filter(function (x) { return x.class_id === c.id; }).length;
        l.appendChild(el('div', 'sub', joined + ' joined' + (st.counts ? ' · ' + countBy(st.counts.notices, c.id) + ' notices · ' + countBy(st.counts.notes, c.id) + ' notes' : '')));
        var r = el('div'); r.appendChild(el('div', 'sub', 'Class code')); r.appendChild(el('div', 'code', c.code));
        card.appendChild(l); card.appendChild(r); cc.appendChild(card);
      });
    } else {
      var mine = classById(st.profile.class_id);
      if (mine) {
        cc.appendChild(el('h3', '', 'Your class'));
        var card2 = el('div', 'ccard');
        card2.appendChild(el('div', '', mine.name));
        var r2 = el('div'); r2.appendChild(el('div', 'sub', 'Class code')); r2.appendChild(el('div', 'code', mine.code)); card2.appendChild(r2);
        cc.appendChild(card2);
      }
    }

    var q = st.search.toLowerCase();
    var list = scope.filter(function (x) { return !q || x.name.toLowerCase().indexOf(q) > -1 || x.roll.toLowerCase().indexOf(q) > -1; });
    var box = $('peopleList'); box.textContent = '';
    box.appendChild(el('h3', '', 'Students (' + list.length + ')'));
    if (!list.length) box.appendChild(el('p', 'empty', q ? 'No one matches this search.' : 'No one has joined yet. Share the class code in your class group.'));
    list.forEach(function (x) {
      var row = el('div', 'prow');
      var l1 = el('div', 'line1');
      var left = el('div'); left.appendChild(el('div', 'nm', x.name));
      left.appendChild(el('div', 'meta', x.roll + (isAdmin() ? ' · ' + className(x.class_id) : '')));
      left.appendChild(el('div', 'meta', seenText(x.last_seen)));
      l1.appendChild(left);
      l1.appendChild(el('span', 'chip r-' + x.role, x.role === 'editor' ? 'CR' : x.role === 'admin' ? 'Admin' : 'Student'));
      row.appendChild(l1);
      if (isAdmin() && x.role !== 'admin') {
        var acts = el('div', 'acts');
        var rb = el('button', 'secondary', x.role === 'editor' ? 'Make student' : 'Make CR'); rb.type = 'button';
        rb.addEventListener('click', async function () {
          var r = await sb.rpc('set_role', { p_roll: x.roll, p_role: x.role === 'editor' ? 'student' : 'editor' });
          if (r.error) { toast(friendly(r.error)); return; }
          toast(x.name + ' is now ' + (x.role === 'editor' ? 'a student' : 'a CR')); loadPeople();
        });
        acts.appendChild(rb);
        acts.appendChild(delBtn('Remove ' + x.name, async function () {
          var r = await sb.rpc('remove_user', { p_roll: x.roll });
          if (r.error) { toast(friendly(r.error)); return; }
          toast(x.name + ' was removed'); loadPeople();
        }));
        row.appendChild(acts);
      }
      box.appendChild(row);
    });
  }
  /* ---------- admin: who can sign up (roll list and sign up switch) ---------- */
  function rollRegex() { var c = classById(st.view); try { return new RegExp(c.roll_regex); } catch (e) { return DEFAULT_ROLL; } }
  function renderRollCard() {
    var card = $('rollCard'); card.hidden = !isAdmin();
    if (!isAdmin()) return;
    var c = classById(st.view); if (!c) { card.hidden = true; return; }
    var rolls = st.allowed.map(function (r) { return r.roll; });
    var joined = {}; st.people.forEach(function (p) { joined[p.roll] = 1; });
    var notJoined = rolls.filter(function (r) { return !joined[r]; }).sort();
    var open = c.signups_open !== false, on = !!c.restrict_rolls;
    $('rcOpen').checked = open; $('rcRestrict').checked = on;
    $('rcSummary').textContent = c.name + ': ' + rolls.length + ' roll numbers on the list, ' + (rolls.length - notJoined.length) + ' joined. Sign ups are ' + (open ? 'open' : 'closed') + '. List check is ' + (on ? 'ON' : 'OFF') + '.';
    $('rcNjSum').textContent = 'Not joined yet (' + notJoined.length + ')';
    $('rcNj').textContent = notJoined.length ? notJoined.join(', ') : (rolls.length ? 'Everyone on the list has joined.' : 'The list is empty.');
    var row = $('rcClearRow'); row.textContent = '';
    if (rolls.length) row.appendChild(delBtn('Clear the roll list', async function () {
      var r = await sb.from('allowed_rolls').delete().eq('class_id', st.view);
      if (r.error) { $('rcErr').textContent = friendly(r.error); return; }
      if (c.restrict_rolls) await setClass({ restrict_rolls: false });
      toast('Roll list cleared'); loadPeople();
    }, 'Clear the list'));
  }
  async function setClass(patch) {
    var r = await sb.from('classes').update(patch).eq('id', st.view);
    if (r.error) { $('rcErr').textContent = friendly(r.error); }
    var c = await sb.from('classes').select('*').order('name');
    if (!c.error) st.classes = c.data || [];
    renderRollCard();
  }
  $('rcOpen').addEventListener('change', function () { $('rcErr').textContent = ''; setClass({ signups_open: $('rcOpen').checked }); });
  $('rcRestrict').addEventListener('change', function () {
    $('rcErr').textContent = '';
    if ($('rcRestrict').checked && !st.allowed.length) { $('rcRestrict').checked = false; $('rcErr').textContent = 'Add roll numbers first. With an empty list nobody could sign up.'; return; }
    setClass({ restrict_rolls: $('rcRestrict').checked });
  });
  async function addRolls(list) {
    var err = $('rcErr'); err.textContent = '';
    var re = rollRegex(), have = {}, seen = {}, ok = [], bad = [];
    st.allowed.forEach(function (r) { have[r.roll] = 1; });
    list.forEach(function (x) {
      x = cleanRoll(x); if (!x || seen[x]) return; seen[x] = 1;
      if (!re.test(x)) bad.push(x); else if (!have[x]) ok.push(x);
    });
    if (!ok.length) { err.textContent = bad.length ? 'These do not match the roll number format: ' + bad.slice(0, 5).join(', ') : 'Nothing new to add. These are already on the list.'; return; }
    for (var i = 0; i < ok.length; i += 200) {
      var rows = ok.slice(i, i + 200).map(function (x) { return { class_id: st.view, roll: x }; });
      var r = await sb.from('allowed_rolls').insert(rows);
      if (r.error) { err.textContent = friendly(r.error); await loadPeople(); return; }
    }
    toast(ok.length + ' roll numbers added' + (bad.length ? ' (' + bad.length + ' skipped)' : ''));
    await loadPeople();
  }
  $('rlGen').addEventListener('click', function () {
    var pre = cleanRoll($('rlPre').value), suf = cleanRoll($('rlSuf').value), a = parseInt($('rlFrom').value, 10), b = parseInt($('rlTo').value, 10), err = $('rcErr');
    if (!pre || isNaN(a) || isNaN(b) || a < 0 || b < a) { err.textContent = 'Fill the start letters, the ending letter and the From and To numbers.'; return; }
    if (b - a > 500) { err.textContent = 'A range can have at most 500 roll numbers.'; return; }
    var list = []; for (var n = a; n <= b; n++) list.push(pre + String(n).padStart(3, '0') + suf);
    addRolls(list);
  });
  $('rlAdd').addEventListener('click', function () {
    var list = $('rlPaste').value.split(/[\s,;]+/);
    addRolls(list).then(function () { if (!$('rcErr').textContent) $('rlPaste').value = ''; });
  });

  $('pSearch').addEventListener('input', function () { st.search = $('pSearch').value.trim(); renderPeople(); });

  $('classForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!isAdmin()) return;
    var err = $('clErr'), name = $('clName').value.trim(), code = $('clCode').value.trim().toUpperCase().replace(/\s+/g, ''), rx = $('clRegex').value.trim();
    if (!name) { err.textContent = 'Enter the class name.'; return; }
    if (code.length < 4 || code.length > 24) { err.textContent = 'The class code must be 4 to 24 characters.'; return; }
    try { new RegExp(rx); } catch (e) { err.textContent = 'The roll number format is not valid.'; return; }
    err.textContent = '';
    var r = await sb.from('classes').insert({ name: name, code: code, roll_regex: rx });
    if (r.error) { err.textContent = /duplicate|unique/i.test(r.error.message) ? 'This class code is already used. Choose another.' : friendly(r.error); return; }
    $('clName').value = ''; $('clCode').value = '';
    var c = await sb.from('classes').select('*').order('name');
    if (!c.error) { st.classes = c.data || []; buildClassBar(); buildTargets(); }
    toast('Class created'); loadPeople();
  });

  boot();
})();
