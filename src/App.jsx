import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { getData, setData, adminLogin, findStudent, upsertStudent } from './api.js';
import { payWithRedsys } from './redsys.js';
import { registerServiceWorker, subscribeToPush, unsubscribeFromPush, getCurrentSubscription, pushSupported } from './push.js';
import { uploadWallImage, deleteWallImage } from './upload.js';

const DAY_INDEX = { Domingo: 0, Lunes: 1, Martes: 2, 'Miércoles': 3, Jueves: 4, Viernes: 5, Sábado: 6 };
const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const DEFAULT_SCHEDULE = {
  Lunes: [
    { time: '08:00', name: 'Balance Yoga' },
    { time: '09:15', name: 'Entrenamiento Funcional' },
    { time: '18:00', name: 'Entrenamiento Funcional' },
    { time: '19:00', name: 'Hatha Yoga' }
  ],
  Martes: [
    { time: '08:00', name: 'Balance Yoga' },
    { time: '09:30', name: 'Entrenamiento Funcional' },
    { time: '18:00', name: 'Entrenamiento Funcional' },
    { time: '19:00', name: 'Rocket Yoga' },
    { time: '20:00', name: 'Entrenamiento Funcional' }
  ],
  'Miércoles': [
    { time: '18:30', name: 'Yoga Restaurativo' },
    { time: '19:30', name: 'Entrenamiento Funcional' },
    { time: '20:30', name: 'Fuerza y Core' }
  ],
  Jueves: [
    { time: '07:00', name: 'Entrenamiento Funcional' },
    { time: '08:00', name: 'Balance Yoga' },
    { time: '09:15', name: 'Entrenamiento Funcional' },
    { time: '18:00', name: 'Entrenamiento Funcional' }
  ],
  Viernes: [
    { time: '07:00', name: 'Entrenamiento Funcional' },
    { time: '08:00', name: 'Balance Yoga' },
    { time: '09:30', name: 'Entrenamiento Funcional' },
    { time: '18:00', name: 'Entrenamiento Funcional' },
    { time: '19:00', name: 'Balance Yoga' }
  ],
  Domingo: [
    { time: '09:00', name: 'Entrenamiento Funcional' },
    { time: '10:00', name: 'Meditación Hatha' }
  ]
};

const CLASS_STYLE = {
  'Balance Yoga': 'pill-lav',
  'Hatha Yoga': 'pill-lav',
  'Rocket Yoga': 'pill-lav',
  'Yoga Restaurativo': 'pill-sage',
  'Meditación Hatha': 'pill-sage',
  'Entrenamiento Funcional': 'pill-gray',
  'Fuerza y Core': 'pill-gray'
};

const DEFAULT_BONOS = [
  { id: 'bono4', name: 'Bono 4', desc: '4 clases al mes · 1 día a la semana', price: 60, classes: 4 },
  { id: 'bono6', name: 'Bono 6', desc: '6 clases al mes · ≥2 días a la semana', price: 80, classes: 6 },
  { id: 'bono8', name: 'Bono 8', desc: '8 clases al mes · 2 días a la semana', price: 95, classes: 8 },
  { id: 'bono10', name: 'Bono 10', desc: '10 clases al mes', price: 105, classes: 10 },
  { id: 'bono12', name: 'Bono 12', desc: '12 clases al mes · 3 días a la semana', price: 120, classes: 12 },
  { id: 'ilimitado', name: 'Bono ilimitado', desc: 'Clases ilimitadas', price: 150, classes: null }
];
// Pago único de 3 meses para cada bono (precio total e importe que se ahorra
// frente a pagar 3 meses sueltos). El de bono12 es una estimación a falta de
// confirmar el precio oficial (no salía en el folleto de trimestres).
const BONO_TRIMESTRE = {
  bono4: { price: 165, ahorro: 15 },
  bono6: { price: 220, ahorro: 20 },
  bono8: { price: 260, ahorro: 25 },
  bono10: { price: 285, ahorro: 30 },
  bono12: { price: 325, ahorro: 35 },
  ilimitado: { price: 405, ahorro: 45 }
};
const CLASE_SUELTA_PRECIO = 20;
const CLASS_CAPACITY = 8;
const BIZUM_PHONE = '691750534';
const HOW_FOUND = ['Instagram', 'Facebook', 'Google', 'Recomendación de una amiga', 'Al pasar por el centro', 'Cartel o flyer', 'Web aditifunctionalyoga.es', 'Otro'];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function isValidIntlPhone(phone) { return /^\+\d{8,15}$/.test((phone || '').replace(/\s/g, '')); }
function fmtDate(d) { return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function sameDate(a, b) { return isoDate(a) === isoDate(b); }
function mondayIndex(d) { return (d.getDay() + 6) % 7; } // Lunes=0 ... Domingo=6
function startOfWeekMonday(d) { return addDays(d, -mondayIndex(d)); }
function dayNameForDate(d) { return Object.keys(DAY_INDEX).find(k => DAY_INDEX[k] === d.getDay()) || ''; }
function bonoName(bonos, id) { const b = (bonos || DEFAULT_BONOS).find(x => x.id === id); return b ? b.name : id; }
function hasActiveBonoAt(purchases, studentId, onDate) {
  return purchases.some(p => p.studentId === studentId && p.status === 'confirmado' && new Date(p.expiryDate) >= onDate && (p.classesTotal === null || p.classesUsed < p.classesTotal));
}
function capitalizeFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('muro');
  const [students, setStudents] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [wallPosts, setWallPosts] = useState([]);
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [bonos, setBonos] = useState(DEFAULT_BONOS);
  const [myId, setMyId] = useState(() => localStorage.getItem('aditi_myId') || null);
  const [me, setMe] = useState(null);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('aditi_admin_token') || null);
  const [isAdmin, setIsAdmin] = useState(() => !!localStorage.getItem('aditi_admin_token'));
  const [adminTab, setAdminTab] = useState('alumnas');
  const [toastMsg, setToastMsg] = useState(null);
  const [modal, setModal] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    let cancelled = false;
    function loadAll() {
      return Promise.all([
        isAdmin ? getData('students', adminToken) : Promise.resolve(null),
        getData('bookings'), getData('purchases'), getData('wallPosts'),
        getData('schedule'), getData('bonos')
      ]).then(([s, b, p, w, sch, bo]) => {
        if (cancelled) return;
        if (isAdmin) setStudents(s || []);
        setBookings(b || []);
        setPurchases(p || []);
        setWallPosts(w || []);
        if (sch) setSchedule(sch);
        if (bo) setBonos(bo);
        setLoading(false);
      }).catch(() => { if (!cancelled) setLoading(false); });
    }
    loadAll();
    const interval = setInterval(loadAll, 5000);
    function onFocus() { loadAll(); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAll(); });
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [isAdmin, adminToken]);

  // La ficha propia se resuelve por separado (no expone el listado completo de alumnas).
  useEffect(() => {
    let cancelled = false;
    if (!myId) { setMe(null); return; }
    findStudent({ id: myId }).then(s => { if (!cancelled) setMe(s || null); });
    return () => { cancelled = true; };
  }, [myId]);

  function toast(msg) {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }

  function saveStudents(next) { setStudents(next); setData('students', next, adminToken); }
  function saveBookings(next) { setBookings(next); setData('bookings', next, adminToken); }
  function savePurchases(next) { setPurchases(next); setData('purchases', next, adminToken); }
  function saveWallPosts(next) { setWallPosts(next); setData('wallPosts', next, adminToken); }
  function saveSchedule(next) { setSchedule(next); setData('schedule', next, adminToken); }
  function saveBonos(next) { setBonos(next); setData('bonos', next, adminToken); }
  function pickProfile(id) { setMyId(id); localStorage.setItem('aditi_myId', id); }
  function clearProfile() { setMyId(null); localStorage.removeItem('aditi_myId'); }

  async function loginAdmin(pin) {
    const token = await adminLogin(pin);
    if (token) {
      setAdminToken(token);
      setIsAdmin(true);
      localStorage.setItem('aditi_admin_token', token);
    }
    return !!token;
  }
  function logoutAdmin() {
    setAdminToken(null);
    setIsAdmin(false);
    localStorage.removeItem('aditi_admin_token');
  }

  function activePurchaseFor(studentId, onDate) {
    const today = onDate || new Date();
    return purchases
      .filter(p => p.studentId === studentId && p.status === 'confirmado' && new Date(p.expiryDate) >= today && (p.classesTotal === null || p.classesUsed < p.classesTotal))
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0];
  }

  return (
    <div className="app-wrap">
      <Header tab={tab} />
      <div className="content">
        {loading ? (
          <div className="empty">Cargando…</div>
        ) : tab === 'muro' ? (
          <MuroTab wallPosts={wallPosts} />
        ) : tab === 'horario' ? (
          <HorarioTab
            bookings={bookings} schedule={schedule}
            onPickClass={(cls, dateIso, day) => setModal({ type: 'booking', day, cls, dateIso })}
          />
        ) : tab === 'bonos' ? (
          <BonosTab me={me} activePurchaseFor={activePurchaseFor} purchases={purchases} bonos={bonos}
            onRequestBono={(bono, trimestre) => {
              if (!me) { toast('Completa tu perfil antes de solicitar un bono'); setTab('perfil'); return; }
              setModal({ type: 'bono', bono, trimestre });
            }} />
        ) : tab === 'perfil' ? (
          <PerfilTab me={me} pickProfile={pickProfile} clearProfile={clearProfile} bonos={bonos}
            purchases={purchases} bookings={bookings} activePurchaseFor={activePurchaseFor}
            isAdmin={isAdmin} onAdminLogin={loginAdmin} onAdminLogout={logoutAdmin} setTab={setTab} toast={toast} />
        ) : tab === 'admin' ? (
          <AdminTab adminTab={adminTab} setAdminTab={setAdminTab}
            students={students} saveStudents={saveStudents} bookings={bookings} purchases={purchases} wallPosts={wallPosts}
            activePurchaseFor={activePurchaseFor} adminToken={adminToken}
            schedule={schedule} saveSchedule={saveSchedule} bonos={bonos} saveBonos={saveBonos}
            savePurchases={savePurchases} saveBookings={saveBookings} saveWallPosts={saveWallPosts}
            toast={toast} />
        ) : null}
      </div>
      <BottomNav tab={tab} setTab={setTab} isAdmin={isAdmin} />
      <a className="wa-float" href="https://wa.me/34652689928?text=Hola%20Beatriz%2C%20te%20escribo%20desde%20la%20app%20de%20Aditi%20Functional%20Yoga" target="_blank" rel="noopener" aria-label="Escribir por WhatsApp a Beatriz">
        <WaIcon />
      </a>
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {modal && modal.type === 'booking' && (
        <BookingModal
          modal={modal} bonos={bonos}
          bookings={bookings} saveBookings={saveBookings} purchases={purchases} savePurchases={savePurchases}
          me={me} myId={myId} pickProfile={pickProfile} activePurchaseFor={activePurchaseFor}
          toast={toast} onClose={() => setModal(null)}
        />
      )}
      {modal && modal.type === 'bono' && (
        <BonoModal modal={modal} me={me} purchases={purchases} savePurchases={savePurchases}
          toast={toast} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function Header({ tab }) {
  const titles = {
    muro: ['Muro', 'Novedades y avisos de Beatriz'],
    horario: ['Reservar clase', 'Elige día y hora'],
    bonos: ['Bonos y pagos', 'Gestiona tu bono mensual'],
    perfil: ['Mi perfil', 'Tus datos en Aditi'],
    admin: ['Panel de Beatriz', 'Gestión de alumnas']
  };
  const [title, sub] = titles[tab] || ['Aditi', ''];
  return (
    <div className="topbar">
      <div className="brandrow">
        <img src="/logo-aditi.png" alt="Aditi" className="logo-mark" />
      </div>
      <div className="headline">{title}</div>
      <div className="headline-sub">{sub}</div>
    </div>
  );
}

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.47 14.38c-.29-.15-1.72-.85-1.98-.95-.27-.1-.46-.15-.66.15-.19.29-.75.95-.92 1.14-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.32-1.43-.86-.76-1.44-1.71-1.61-2-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.19-.29.29-.49.1-.19.05-.36-.02-.51-.07-.15-.66-1.59-.9-2.18-.24-.58-.48-.5-.66-.51-.17-.01-.36-.01-.56-.01s-.51.07-.78.36c-.27.29-1.02 1-1.02 2.44s1.05 2.83 1.19 3.03c.15.19 2.06 3.15 5 4.42.7.3 1.24.48 1.67.61.7.22 1.34.19 1.84.12.56-.08 1.72-.7 1.96-1.38.24-.68.24-1.26.17-1.38-.07-.12-.27-.19-.56-.34z" />
      <path d="M12.02 2C6.5 2 2.02 6.48 2.02 12c0 1.83.48 3.6 1.4 5.16L2 22l4.98-1.31A9.96 9.96 0 0012.02 22c5.52 0 10-4.48 10-10s-4.48-10-10-10zm0 18.18c-1.62 0-3.2-.44-4.58-1.26l-.33-.2-3.29.86.88-3.2-.21-.33A8.18 8.18 0 013.84 12c0-4.5 3.68-8.18 8.18-8.18S20.2 7.5 20.2 12s-3.68 8.18-8.18 8.18z" />
    </svg>
  );
}

function BottomNav({ tab, setTab, isAdmin }) {
  const tabs = [
    { id: 'muro', label: 'Muro', ic: '☀' },
    { id: 'horario', label: 'Reservar', ic: '📅' },
    { id: 'bonos', label: 'Bonos', ic: '💰' },
    { id: 'perfil', label: 'Perfil', ic: '👤' }
  ];
  if (isAdmin) tabs.push({ id: 'admin', label: 'Beatriz', ic: '★' });
  return (
    <div className="bottomnav"><div className="bottomnav-inner">
      {tabs.map(t => (
        <button key={t.id} className={`navbtn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
          <span className="ic">{t.ic}</span><span>{t.label}</span>
        </button>
      ))}
    </div></div>
  );
}

/* ---------------- MURO ---------------- */
function MuroTab({ wallPosts }) {
  const posts = [...wallPosts].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (posts.length === 0) {
    return <div className="empty"><div className="glyph">🌿</div>Todavía no hay novedades.<br />Aquí verás los avisos y eventos de Beatriz.</div>;
  }
  return posts.map(p => (
    <div className="card postcard" key={p.id}>
      <div className="postdate">{fmtDate(new Date(p.date))}</div>
      <h3>{p.title}</h3>
      {p.imageUrl && <img src={p.imageUrl} alt="" className="postimg" />}
      <p>{p.content}</p>
    </div>
  ));
}

/* ---------------- HORARIO ---------------- */
function HorarioTab({ bookings, schedule, onPickClass }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const isCurrentWeek = sameDate(weekStart, startOfWeekMonday(new Date()));

  return (
    <>
      <MiniMonthCalendar
        monthCursor={monthCursor} setMonthCursor={setMonthCursor} weekStart={weekStart}
        onPickDate={(date) => setWeekStart(startOfWeekMonday(date))}
      />
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 10px' }}>
        <button className="btn btn-outline btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Semana anterior</button>
        {!isCurrentWeek && <button className="linklike" onClick={() => setWeekStart(startOfWeekMonday(new Date()))}>Ir a hoy</button>}
        <button className="btn btn-outline btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>Siguiente →</button>
      </div>
      {weekDates.map(date => {
        const dayName = dayNameForDate(date);
        const classes = schedule[dayName] || [];
        const dateIso = isoDate(date);
        const isToday = sameDate(date, new Date());
        return (
          <div key={dateIso} style={{ marginBottom: 18 }}>
            <div className="sectionlabel" style={{ margin: '0 0 8px', textTransform: 'none' }}>
              {dayName} {date.getDate()} {isToday && <span className="pill pill-lav" style={{ marginLeft: 6 }}>Hoy</span>}
            </div>
            {classes.length === 0 ? (
              <div className="muted" style={{ padding: '4px 0 8px' }}>Sin clases este día.</div>
            ) : classes.map((c, idx) => {
              const attendees = bookings.filter(b => b.date === dateIso && b.time === c.time && b.className === c.name && b.status !== 'cancelada').length;
              const full = attendees >= CLASS_CAPACITY;
              return (
                <div className="classcard" key={idx} onClick={() => onPickClass(c, dateIso, dayName)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                    <div className="time">{c.time}</div>
                    <div className="name">{c.name}</div>
                  </div>
                  <span className={`pill ${full ? 'pill-gray' : (CLASS_STYLE[c.name] || 'pill-lav')}`}>{full ? 'Completo' : 'Reservar'}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function MiniMonthCalendar({ monthCursor, setMonthCursor, weekStart, onPickDate }) {
  const month = monthCursor.getMonth();
  const gridStart = startOfWeekMonday(new Date(monthCursor.getFullYear(), month, 1));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'nowrap' }}>
        <button className="linklike" style={{ fontSize: 18, textDecoration: 'none' }} onClick={() => setMonthCursor(addMonths(monthCursor, -1))}>‹</button>
        <b style={{ fontSize: 13.5 }}>{capitalizeFirst(monthCursor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))}</b>
        <button className="linklike" style={{ fontSize: 18, textDecoration: 'none' }} onClick={() => setMonthCursor(addMonths(monthCursor, 1))}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
        {WEEKDAY_LETTERS.map(l => <div key={l} className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{l}</div>)}
        {days.map(d => {
          const inMonth = d.getMonth() === month;
          const inWeek = weekDates.some(w => sameDate(w, d));
          const isToday = sameDate(d, today);
          return (
            <div key={isoDate(d)} onClick={() => onPickDate(d)}
              style={{
                padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12.5,
                opacity: inMonth ? 1 : 0.32,
                background: inWeek ? 'var(--lav-pale)' : 'transparent',
                fontWeight: isToday ? 700 : 400,
                color: isToday ? 'var(--plum)' : 'var(--ink)'
              }}>
              {d.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- BONOS ---------------- */
function BonosTab({ me, activePurchaseFor, purchases, bonos, onRequestBono }) {
  const active = me ? activePurchaseFor(me.id) : null;
  const pendiente = me ? purchases.filter(p => p.studentId === me.id && p.status === 'pendiente').sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate))[0] : null;
  return (
    <>
      {!me ? (
        <div className="card" style={{ background: 'var(--lav-pale)', borderColor: 'var(--lav)' }}>
          <h3 style={{ color: 'var(--plum-2)' }}>Consulta libre</h3>
          <p className="muted">Puedes ver todos los bonos y precios sin registrarte. Para contratar uno te pediremos rellenar tus datos.</p>
        </div>
      ) : (
        <>
          <div className="sectionlabel">Tu bono actual</div>
          {active ? (
            <div className="card">
              <h3>{bonoName(bonos, active.bonoId)}{active.trimestre && ' · Trimestre'}</h3>
              <p className="muted">Clases disponibles: <b>{active.classesTotal === null ? 'Ilimitadas' : `${active.classesTotal - active.classesUsed} de ${active.classesTotal}`}</b></p>
              <p className="muted">Válido hasta {fmtDate(new Date(active.expiryDate))}</p>
            </div>
          ) : pendiente ? (
            <div className="card"><h3>{bonoName(bonos, pendiente.bonoId)}{pendiente.trimestre && ' · Trimestre'}</h3><p className="muted">Solicitado, pendiente de confirmar el pago con Beatriz.</p></div>
          ) : (
            <div className="empty">No tienes ningún bono activo ahora mismo.</div>
          )}
        </>
      )}
      <div className="sectionlabel">Elige un bono</div>
      {bonos.map(b => {
        const tri = BONO_TRIMESTRE[b.id];
        return (
          <div className="card" key={b.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><h3>{b.name}</h3><p className="muted">{b.desc}</p></div>
              <div style={{ textAlign: 'right' }}>
                <div className="serif" style={{ fontSize: 19, fontWeight: 600, color: 'var(--plum)' }}>{b.price}€/mes</div>
                <button className="btn btn-sage btn-sm" style={{ marginTop: 6 }} onClick={() => onRequestBono(b, false)}>Solicitar</button>
              </div>
            </div>
            {tri && (
              <>
                <hr className="sep" style={{ margin: '10px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p className="muted" style={{ margin: 0 }}>Trimestre (3 meses) · ahorras {tri.ahorro}€</p>
                  <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="serif" style={{ fontSize: 16, fontWeight: 600, color: 'var(--plum)' }}>{tri.price}€</div>
                    <button className="btn btn-outline btn-sm" onClick={() => onRequestBono(b, true)}>Solicitar</button>
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}
      <div className="card" style={{ background: 'var(--peach-pale)', borderColor: 'var(--peach)' }}>
        <h3 style={{ color: '#8A4128' }}>Clase suelta</h3>
        <p className="muted">Si no tienes bono, puedes reservar una clase individual por {CLASE_SUELTA_PRECIO}€ desde la pestaña Reservar.</p>
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 6 }}>Puedes pagar con tarjeta al momento o por Bizum al {BIZUM_PHONE}. La app registra tu solicitud y, si pagas por Bizum, Beatriz la confirma en cuanto lo recibe.</p>
    </>
  );
}

/* ---------------- PERFIL ---------------- */
function ProfileForm({ existing, onSave }) {
  const [name, setName] = useState(existing?.name || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [birthday, setBirthday] = useState(existing?.birthday || '');
  const [howFound, setHowFound] = useState(existing?.howFound || '');

  return (
    <div className="card">
      <label>Nombre y apellidos</label>
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre completo" />
      <label>Email</label>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tunombre@correo.com" />
      <label>Teléfono (con prefijo de país)</label>
      <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34600123456" />
      <label>Fecha de nacimiento</label>
      <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)} />
      <label>¿Cómo nos has conocido?</label>
      <select value={howFound} onChange={e => setHowFound(e.target.value)}>
        <option value="">Selecciona una opción</option>
        {HOW_FOUND.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => {
        if (!name.trim() || !phone.trim()) return onSave(null, 'Nombre y teléfono son obligatorios');
        if (!isValidIntlPhone(phone)) return onSave(null, 'El teléfono debe incluir el prefijo del país, ej. +34600123456');
        onSave({ name: name.trim(), email: email.trim(), phone: phone.trim(), birthday, howFound });
      }}>{existing ? 'Guardar cambios' : 'Crear mi perfil'}</button>
    </div>
  );
}

function NotificationsCard({ studentId, toast }) {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(pushSupported());
    if (pushSupported()) {
      getCurrentSubscription().then(sub => setSubscribed(!!sub));
    }
  }, []);

  if (!supported) return null;

  async function handleToggle() {
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
        toast('Notificaciones desactivadas');
      } else {
        await subscribeToPush(studentId);
        setSubscribed(true);
        toast('¡Notificaciones activadas!');
      }
    } catch (e) {
      toast(e.message || 'No se pudieron activar las notificaciones');
    }
    setBusy(false);
  }

  return (
    <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <div>
        <h3>Notificaciones</h3>
        <p className="muted">Recibe un aviso en el móvil cada vez que Beatriz publique algo en el Muro.</p>
      </div>
      <button className={`btn btn-sm ${subscribed ? 'btn-outline' : 'btn-sage'}`} disabled={busy} onClick={handleToggle}>
        {subscribed ? 'Desactivar' : 'Activar'}
      </button>
    </div>
  );
}

function MyBonoCard({ me, purchases, activePurchaseFor, bonos }) {
  const active = activePurchaseFor(me.id);
  const pendiente = purchases.filter(p => p.studentId === me.id && p.status === 'pendiente')
    .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate))[0];

  if (!active && !pendiente) {
    return (
      <div className="card">
        <h3>Mi bono</h3>
        <p className="muted">No tienes ningún bono activo ahora mismo.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Mi bono</h3>
      {active ? (
        <>
          <p className="muted">{bonoName(bonos, active.bonoId)}{active.trimestre && ' · Trimestre'}</p>
          <p className="muted">Clases disponibles: <b>{active.classesTotal === null ? 'Ilimitadas' : `${active.classesTotal - active.classesUsed} de ${active.classesTotal}`}</b></p>
          <p className="muted">Válido hasta {fmtDate(new Date(active.expiryDate))}</p>
        </>
      ) : (
        <p className="muted">{bonoName(bonos, pendiente.bonoId)}{pendiente.trimestre && ' · Trimestre'} · solicitado, pendiente de confirmar el pago.</p>
      )}
    </div>
  );
}

function MyUpcomingBookings({ me, bookings }) {
  const upcoming = bookings
    .filter(b => b.studentId === me.id && b.status !== 'cancelada' && new Date(b.date) >= addDays(new Date(), -1))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (upcoming.length === 0) return null;

  const statusLabel = { confirmada: 'Confirmada', pendiente_pago: 'Pendiente de pago' };

  return (
    <>
      <div className="sectionlabel">Mis próximas clases</div>
      {upcoming.map(b => (
        <div className="card" key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3>{b.className}</h3>
            <p className="muted">{fmtDate(new Date(b.date))} · {b.time}</p>
          </div>
          <span className={`pill ${b.status === 'confirmada' ? 'pill-sage' : 'pill-gray'}`}>{statusLabel[b.status] || b.status}</span>
        </div>
      ))}
    </>
  );
}

function PerfilTab({ me, pickProfile, clearProfile, purchases, bookings, activePurchaseFor, bonos, isAdmin, onAdminLogin, onAdminLogout, setTab, toast }) {
  const [searchPhone, setSearchPhone] = useState('');
  const [searching, setSearching] = useState(false);

  async function handleSave(data, error) {
    if (error) { toast(error); return; }
    const saved = await upsertStudent(me ? { id: me.id, ...data } : { id: uid(), ...data, createdAt: new Date().toISOString() });
    if (!saved) { toast('No se pudo guardar el perfil, inténtalo de nuevo'); return; }
    if (!me) pickProfile(saved.id);
    toast('Perfil guardado');
  }

  async function handleSearch() {
    if (!searchPhone.trim()) { toast('Escribe un teléfono para buscar'); return; }
    setSearching(true);
    const found = await findStudent({ phone: searchPhone });
    setSearching(false);
    if (found) { pickProfile(found.id); toast(`Perfil encontrado, ¡hola ${found.name.split(' ')[0]}!`); }
    else toast('No encontramos ese teléfono. Crea un perfil nuevo.');
  }

  return (
    <>
      <NotificationsCard studentId={me ? me.id : null} toast={toast} />
      {me ? (
        <>
          <div className="card">
            <h3>{me.name}</h3>
            <p className="muted">{me.email}<br />{me.phone}</p>
            <p className="muted">Cumpleaños: {me.birthday || '—'}</p>
            <p className="muted">Cómo nos conoció: {me.howFound || '—'}</p>
          </div>
          <MyBonoCard me={me} purchases={purchases} activePurchaseFor={activePurchaseFor} bonos={bonos} />
          <MyUpcomingBookings me={me} bookings={bookings} />
          <div className="sectionlabel">Editar datos</div>
          <ProfileForm existing={me} onSave={handleSave} />
          <hr className="sep" />
          <button className="linklike" onClick={clearProfile}>No soy {me.name.split(' ')[0]}, cambiar de alumna</button>
        </>
      ) : (
        <>
          <div className="card"><h3>Bienvenida a Aditi</h3><p className="muted">Cuéntanos un poco sobre ti para poder reservar tus clases.</p></div>
          <div className="sectionlabel">¿Ya tienes perfil?</div>
          <div className="card">
            <label>Buscar por teléfono</label>
            <input type="tel" value={searchPhone} onChange={e => setSearchPhone(e.target.value)} placeholder="Ej. 600123456" />
            <button className="btn btn-outline" style={{ marginTop: 10 }} disabled={searching} onClick={handleSearch}>{searching ? 'Buscando…' : 'Buscar mi perfil'}</button>
          </div>
          <div className="sectionlabel">Crear perfil nuevo</div>
          <ProfileForm existing={null} onSave={handleSave} />
        </>
      )}
      <hr className="sep" />
      {isAdmin ? (
        <button className="btn btn-outline" onClick={() => { onAdminLogout(); setTab('perfil'); }}>Salir del panel de Beatriz</button>
      ) : (
        <button className="linklike" onClick={async () => {
          const pin = prompt('Introduce el PIN de acceso de Beatriz:');
          if (pin === null) return;
          const ok = await onAdminLogin(pin);
          if (ok) setTab('admin'); else toast('PIN incorrecto');
        }}>¿Eres Beatriz? Acceso profesora</button>
      )}
    </>
  );
}

/* ---------------- ADMIN ---------------- */
function AdminAlumnaCard({ s, students, saveStudents, active, total, bonos, purchases, savePurchases, bookings, saveBookings, toast }) {
  const [editing, setEditing] = useState(false);
  const [assigningBono, setAssigningBono] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [bonoId, setBonoId] = useState('');
  const [trimestre, setTrimestre] = useState(false);
  const [payMethod, setPayMethod] = useState('efectivo');
  const [purchaseDateStr, setPurchaseDateStr] = useState(() => isoDate(new Date()));

  function handleSave(data, error) {
    if (error) { toast(error); return; }
    saveStudents(students.map(x => x.id === s.id ? { ...x, ...data } : x));
    setEditing(false);
    toast('Alumna actualizada');
  }

  function handleDelete() {
    if (!confirm(`¿Seguro que quieres eliminar a ${s.name}? Sus reservas y bonos no se borrarán, pero dejarán de mostrar su nombre.`)) return;
    saveStudents(students.filter(x => x.id !== s.id));
    toast('Alumna eliminada');
  }

  function handleAssignBono() {
    const b = bonos.find(x => x.id === bonoId);
    if (!b) { toast('Elige un bono'); return; }
    const tri = trimestre ? BONO_TRIMESTRE[b.id] : null;
    const realPurchaseDate = purchaseDateStr ? new Date(`${purchaseDateStr}T12:00:00`) : new Date();
    const purchase = {
      id: uid(), studentId: s.id, bonoId: b.id, trimestre: !!tri,
      price: tri ? tri.price : b.price,
      classesTotal: b.classes === null ? null : (tri ? b.classes * 3 : b.classes),
      classesUsed: 0, status: 'confirmado', paymentMethod: payMethod,
      purchaseDate: realPurchaseDate.toISOString(), expiryDate: addDays(realPurchaseDate, tri ? 90 : 30).toISOString()
    };
    savePurchases([...purchases, purchase]);
    setAssigningBono(false);
    setBonoId('');
    setTrimestre(false);
    setPurchaseDateStr(isoDate(new Date()));
    toast(`${b.name} dado de alta (${payMethod}) para ${s.name}`);
  }

  if (editing) {
    return (
      <div className="card">
        <ProfileForm existing={s} onSave={handleSave} />
        <button className="linklike" style={{ marginTop: 8 }} onClick={() => setEditing(false)}>Cancelar</button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>{s.name} {s.isPuntual && <span className="pill pill-peach">Puntual</span>}</h3>
      <p className="muted">{s.phone} · {s.email}</p>
      <p className="muted">Cumpleaños: {s.birthday || '—'} · Conoció por: {s.howFound || '—'}</p>
      <div className="row" style={{ marginTop: 8 }}>
        <span className={`pill ${active ? 'pill-sage' : 'pill-gray'}`}>{active ? `${bonoName(bonos, active.bonoId)} activo` : 'Sin bono activo'}</span>
        <span className="pill pill-lav">{total} reservas totales</span>
        {typeof s.legacyReservas === 'number' && <span className="pill pill-gray">{s.legacyReservas} históricas (app anterior)</span>}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="linklike" onClick={() => setEditing(true)}>Editar</button>
        <button className="linklike" onClick={() => setAssigningBono(!assigningBono)}>{assigningBono ? 'Cancelar' : '+ Bono en efectivo'}</button>
        <button className="linklike" onClick={() => setShowDetail(!showDetail)}>{showDetail ? 'Ocultar bonos y reservas' : 'Ver bonos y reservas'}</button>
        <button className="linklike" style={{ color: 'var(--danger)' }} onClick={handleDelete}>Eliminar</button>
      </div>
      {showDetail && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <div className="sectionlabel" style={{ marginTop: 0 }}>Sus bonos</div>
          {purchases.filter(p => p.studentId === s.id).length === 0 ? <p className="muted">Sin bonos todavía.</p> :
            [...purchases].filter(p => p.studentId === s.id)
              .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate))
              .map(p => <AdminBonoEditRow key={p.id} p={p} bonos={bonos} purchases={purchases} savePurchases={savePurchases} toast={toast} />)}
          <div className="sectionlabel">Sus reservas</div>
          {bookings.filter(b => b.studentId === s.id).length === 0 ? <p className="muted">Sin reservas todavía.</p> :
            [...bookings].filter(b => b.studentId === s.id)
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map(b => <AdminReservaEditRow key={b.id} b={b} bookings={bookings} saveBookings={saveBookings} toast={toast} />)}
        </div>
      )}
      {assigningBono && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <label>Bono ya pagado (fuera de la app)</label>
          <select value={bonoId} onChange={e => setBonoId(e.target.value)}>
            <option value="">Selecciona un bono</option>
            {bonos.map(b => <option key={b.id} value={b.id}>{b.name} · {b.price}€</option>)}
          </select>
          {bonoId && BONO_TRIMESTRE[bonoId] && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={trimestre} onChange={e => setTrimestre(e.target.checked)} />
              Trimestre ({BONO_TRIMESTRE[bonoId].price}€, 3 meses)
            </label>
          )}
          <label>Método de pago</label>
          <select value={payMethod} onChange={e => setPayMethod(e.target.value)}>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
          </select>
          <label>Fecha real de la compra</label>
          <input type="date" value={purchaseDateStr} max={isoDate(new Date())} onChange={e => setPurchaseDateStr(e.target.value)} />
          <p className="muted" style={{ marginTop: 4 }}>El bono caduca 30 (o 90 si es trimestre) días después de esta fecha, no de hoy.</p>
          <button className="btn btn-sage btn-sm" style={{ marginTop: 10 }} onClick={handleAssignBono}>Confirmar alta</button>
        </div>
      )}
    </div>
  );
}

function AdminBonoEditRow({ p, bonos, purchases, savePurchases, toast }) {
  const [editing, setEditing] = useState(false);
  const [classesUsed, setClassesUsed] = useState(p.classesUsed || 0);
  const [expiryDateStr, setExpiryDateStr] = useState(() => isoDate(new Date(p.expiryDate)));

  function save() {
    const next = purchases.map(x => x.id === p.id
      ? { ...x, classesUsed: Number(classesUsed) || 0, expiryDate: new Date(`${expiryDateStr}T12:00:00`).toISOString() }
      : x);
    savePurchases(next);
    setEditing(false);
    toast('Bono actualizado');
  }
  function cancelBono() {
    if (!confirm(`¿Cancelar este bono (${bonoName(bonos, p.bonoId)})?`)) return;
    savePurchases(purchases.map(x => x.id === p.id ? { ...x, status: 'cancelado' } : x));
    toast('Bono cancelado');
  }

  const vencido = new Date(p.expiryDate) < new Date();
  const statusPill = p.status === 'confirmado' ? (vencido ? 'pill-gray' : 'pill-sage') : p.status === 'pendiente' ? 'pill-lav' : 'pill-gray';

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{bonoName(bonos, p.bonoId)}{p.trimestre && ' · Trimestre'}</h3>
        <span className={`pill ${statusPill}`}>{p.status}{p.status === 'confirmado' && vencido ? ' (caducado)' : ''}</span>
      </div>
      {editing ? (
        <>
          <label>Clases usadas{p.classesTotal !== null ? ` (de ${p.classesTotal})` : ''}</label>
          <input type="number" min="0" value={classesUsed} onChange={e => setClassesUsed(e.target.value)} disabled={p.classesTotal === null} />
          <label>Caduca</label>
          <input type="date" value={expiryDateStr} onChange={e => setExpiryDateStr(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sage btn-sm" onClick={save}>Guardar</button>
            <button className="linklike" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{p.classesTotal === null ? 'Clases ilimitadas' : `${p.classesUsed || 0} de ${p.classesTotal} usadas`} · {p.price}€ · {PAYMENT_LABELS[p.paymentMethod] || p.paymentMethod}</p>
          <p className="muted">Comprado el {fmtDate(new Date(p.purchaseDate))} · Caduca el {fmtDate(new Date(p.expiryDate))}</p>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="linklike" onClick={() => setEditing(true)}>Editar</button>
            {p.status !== 'cancelado' && <button className="linklike" style={{ color: 'var(--danger)' }} onClick={cancelBono}>Cancelar bono</button>}
          </div>
        </>
      )}
    </div>
  );
}

function AdminReservaEditRow({ b, bookings, saveBookings, toast }) {
  function cancelBooking() {
    if (!confirm(`¿Cancelar esta reserva (${b.className}, ${fmtDate(new Date(b.date))})?`)) return;
    saveBookings(bookings.map(x => x.id === b.id ? { ...x, status: 'cancelada' } : x));
    toast('Reserva cancelada');
  }
  function markPaid() {
    saveBookings(bookings.map(x => x.id === b.id ? { ...x, status: 'confirmada' } : x));
    toast('Reserva marcada como pagada');
  }

  const statusPill = b.status === 'confirmada' ? 'pill-sage' : b.status === 'pendiente_pago' ? 'pill-lav' : 'pill-gray';

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{b.className}</h3>
        <span className={`pill ${statusPill}`}>{b.status}</span>
      </div>
      <p className="muted">{fmtDate(new Date(b.date))} · {b.time} · {b.paymentMethod === 'bono' ? 'Con bono' : (PAYMENT_LABELS[b.paymentMethod] || b.paymentMethod)}</p>
      <div className="row" style={{ marginTop: 8 }}>
        {b.status === 'pendiente_pago' && <button className="btn btn-sage btn-sm" onClick={markPaid}>Marcar pagada</button>}
        {b.status !== 'cancelada' && <button className="linklike" style={{ color: 'var(--danger)' }} onClick={cancelBooking}>Cancelar</button>}
      </div>
    </div>
  );
}

const PAYMENT_LABELS = { redsys: 'Tarjeta', bizum: 'Bizum', efectivo: 'Efectivo', transferencia: 'Transferencia' };

function AdminEstadisticas({ students, purchases, bookings, bonos }) {
  const [period, setPeriod] = useState('mes');
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  function inPeriod(dateStr) {
    if (period === 'todo') return true;
    return dateStr && new Date(dateStr) >= startOfMonth;
  }

  const paidPurchases = purchases.filter(p => p.status === 'confirmado' && inPeriod(p.purchaseDate));
  const paidBookings = bookings.filter(b => b.status === 'confirmada' && b.paymentMethod !== 'bono' && inPeriod(b.createdAt));

  const revenueByMethod = {};
  let totalBonos = 0, totalSueltas = 0;
  paidPurchases.forEach(p => { revenueByMethod[p.paymentMethod] = (revenueByMethod[p.paymentMethod] || 0) + (p.price || 0); totalBonos += p.price || 0; });
  paidBookings.forEach(b => { revenueByMethod[b.paymentMethod] = (revenueByMethod[b.paymentMethod] || 0) + (b.price || 0); totalSueltas += b.price || 0; });
  const totalRevenue = totalBonos + totalSueltas;

  const conBono = students.filter(s => !s.isPuntual && hasActiveBonoAt(purchases, s.id, now)).length;
  const sinBono = students.filter(s => !s.isPuntual && !hasActiveBonoAt(purchases, s.id, now)).length;
  const puntuales = students.filter(s => s.isPuntual).length;

  const classCount = {};
  bookings.filter(b => b.status === 'confirmada' && inPeriod(b.createdAt)).forEach(b => {
    classCount[b.className] = (classCount[b.className] || 0) + 1;
  });
  const topClasses = Object.entries(classCount).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const bonoCount = {};
  purchases.filter(p => p.status === 'confirmado' && new Date(p.expiryDate) >= now).forEach(p => {
    bonoCount[p.bonoId] = (bonoCount[p.bonoId] || 0) + 1;
  });
  const topBonos = Object.entries(bonoCount).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="daychips">
        <div className={`chip ${period === 'mes' ? 'active' : ''}`} onClick={() => setPeriod('mes')}>Este mes</div>
        <div className={`chip ${period === 'todo' ? 'active' : ''}`} onClick={() => setPeriod('todo')}>Histórico</div>
      </div>

      <div className="sectionlabel">Facturación {period === 'mes' ? 'de este mes' : 'histórica'}</div>
      <div className="card">
        <div className="serif" style={{ fontSize: 30, fontWeight: 700, color: 'var(--plum)' }}>{totalRevenue}€</div>
        <p className="muted" style={{ marginTop: 4 }}>Bonos: {totalBonos}€ · Clases sueltas: {totalSueltas}€</p>
        <div className="row" style={{ marginTop: 10 }}>
          {Object.keys(PAYMENT_LABELS).map(k => revenueByMethod[k] ? (
            <span key={k} className="pill pill-lav">{PAYMENT_LABELS[k]}: {revenueByMethod[k]}€</span>
          ) : null)}
          {totalRevenue === 0 && <span className="muted">Sin ingresos registrados en este periodo.</span>}
        </div>
      </div>

      <div className="sectionlabel">Alumnas</div>
      <div className="card">
        <div className="row">
          <span className="pill pill-sage">{conBono} con bono activo</span>
          <span className="pill pill-gray">{sinBono} sin bono activo</span>
          <span className="pill pill-peach">{puntuales} puntuales</span>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>{students.length} alumnas registradas en total.</p>
      </div>

      <div className="sectionlabel">Clases más populares {period === 'mes' ? '(este mes)' : '(histórico)'}</div>
      {topClasses.length === 0 ? <div className="empty">Todavía no hay reservas confirmadas en este periodo.</div> :
        topClasses.map(([name, count]) => (
          <div className="card" key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{name}</span>
            <span className="pill pill-lav">{count} reserva{count === 1 ? '' : 's'}</span>
          </div>
        ))}

      <div className="sectionlabel">Bonos activos por tipo</div>
      {topBonos.length === 0 ? <div className="empty">No hay bonos activos ahora mismo.</div> :
        topBonos.map(([id, count]) => (
          <div className="card" key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{bonoName(bonos, id)}</span>
            <span className="pill pill-sage">{count} activo{count === 1 ? '' : 's'}</span>
          </div>
        ))}
    </>
  );
}

function AdminTab({ adminTab, setAdminTab, students, saveStudents, bookings, purchases, wallPosts, activePurchaseFor, adminToken, schedule, saveSchedule, bonos, saveBonos, savePurchases, saveBookings, saveWallPosts, toast }) {
  const [alumnaSearch, setAlumnaSearch] = useState('');
  const tabs = [
    { id: 'estadisticas', label: 'Estadísticas' },
    { id: 'resumen', label: 'Resumen del día' },
    { id: 'alumnas', label: 'Alumnas' },
    { id: 'bonospend', label: 'Bonos pendientes' },
    { id: 'bonosactivos', label: 'Bonos confirmados' },
    { id: 'horarios', label: 'Horarios' },
    { id: 'gestionbonos', label: 'Gestionar bonos' },
    { id: 'muro', label: 'Publicar en el muro' },
    { id: 'importar', label: 'Importar alumnas' }
  ];
  return (
    <>
      <div className="daychips">
        {tabs.map(t => (
          <div key={t.id} className={`chip ${adminTab === t.id ? 'active' : ''}`} onClick={() => setAdminTab(t.id)}>{t.label}</div>
        ))}
      </div>
      {adminTab === 'estadisticas' && (
        <AdminEstadisticas students={students} purchases={purchases} bookings={bookings} bonos={bonos} />
      )}
      {adminTab === 'resumen' && (
        <AdminResumen students={students} bookings={bookings} saveBookings={saveBookings} schedule={schedule} toast={toast} />
      )}
      {adminTab === 'alumnas' && (
        <>
          <input type="text" value={alumnaSearch} onChange={e => setAlumnaSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono o email…" style={{ marginBottom: 14 }} />
          {(() => {
            const q = alumnaSearch.trim().toLowerCase();
            const filtered = !q ? students : students.filter(s =>
              (s.name || '').toLowerCase().includes(q) ||
              (s.phone || '').toLowerCase().includes(q) ||
              (s.email || '').toLowerCase().includes(q)
            );
            if (students.length === 0) return <div className="empty">Todavía no hay alumnas registradas.</div>;
            if (filtered.length === 0) return <div className="empty">No hay ninguna alumna que coincida con "{alumnaSearch}".</div>;
            return [...filtered].sort((a, b) => a.name.localeCompare(b.name)).map(s => (
              <AdminAlumnaCard key={s.id} s={s} students={students} saveStudents={saveStudents}
                active={activePurchaseFor(s.id)} total={bookings.filter(b => b.studentId === s.id).length}
                bonos={bonos} purchases={purchases} savePurchases={savePurchases}
                bookings={bookings} saveBookings={saveBookings} toast={toast} />
            ));
          })()}
        </>
      )}
      {adminTab === 'bonospend' && (
        <>
          <div className="sectionlabel">Bonos por confirmar</div>
          {purchases.filter(p => p.status === 'pendiente').length === 0 ? <div className="empty">No hay bonos pendientes de pago.</div> :
            purchases.filter(p => p.status === 'pendiente').map(p => {
              const s = students.find(x => x.id === p.studentId);
              return (
                <div className="card" key={p.id}>
                  <h3>{bonoName(bonos, p.bonoId)}{p.trimestre && ' · Trimestre'} <span className="pill pill-lav">{p.paymentMethod === 'redsys' ? 'Tarjeta' : 'Bizum'}</span></h3>
                  <p className="muted">{s ? s.name : 'Alumna eliminada'} · {s ? s.phone : ''}</p>
                  <p className="muted">Solicitado el {fmtDate(new Date(p.purchaseDate))}</p>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn btn-sage btn-sm" onClick={() => {
                      const next = purchases.map(x => x.id === p.id ? { ...x, status: 'confirmado', expiryDate: addDays(new Date(), p.trimestre ? 90 : 30).toISOString() } : x);
                      savePurchases(next);
                      toast('Bono confirmado');
                    }}>Marcar como pagado</button>
                    <button className="btn btn-outline btn-sm" onClick={() => {
                      if (!confirm(`¿Cancelar la solicitud de ${bonoName(bonos, p.bonoId)} de ${s ? s.name : 'esta alumna'}?`)) return;
                      savePurchases(purchases.map(x => x.id === p.id ? { ...x, status: 'cancelado' } : x));
                      toast('Solicitud cancelada');
                    }}>Cancelar</button>
                  </div>
                </div>
              );
            })}
          <div className="sectionlabel">Clases sueltas por confirmar</div>
          {bookings.filter(b => b.status === 'pendiente_pago').length === 0 ? <div className="empty">No hay clases sueltas pendientes de pago.</div> :
            bookings.filter(b => b.status === 'pendiente_pago').map(b => {
              const s = students.find(x => x.id === b.studentId);
              return (
                <div className="card" key={b.id}>
                  <h3>{b.className} <span className="pill pill-lav">{b.paymentMethod === 'redsys' ? 'Tarjeta' : 'Bizum'}</span></h3>
                  <p className="muted">{s ? s.name : 'Alumna eliminada'} · {fmtDate(new Date(b.date))} {b.time}</p>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn btn-sage btn-sm" onClick={() => {
                      const next = bookings.map(x => x.id === b.id ? { ...x, status: 'confirmada' } : x);
                      saveBookings(next);
                      toast('Clase suelta confirmada');
                    }}>Marcar como pagada</button>
                    <button className="btn btn-outline btn-sm" onClick={() => {
                      if (!confirm(`¿Cancelar la reserva de ${s ? s.name : 'esta alumna'}?`)) return;
                      saveBookings(bookings.map(x => x.id === b.id ? { ...x, status: 'cancelada' } : x));
                      toast('Reserva cancelada');
                    }}>Cancelar</button>
                  </div>
                </div>
              );
            })}
        </>
      )}
      {adminTab === 'bonosactivos' && (
        <>
          <div className="sectionlabel">Bonos confirmados</div>
          {purchases.filter(p => p.status === 'confirmado').length === 0 ? <div className="empty">Todavía no hay bonos confirmados.</div> :
            [...purchases].filter(p => p.status === 'confirmado')
              .sort((a, b) => new Date(b.expiryDate) - new Date(a.expiryDate))
              .map(p => {
                const s = students.find(x => x.id === p.studentId);
                const vencido = new Date(p.expiryDate) < new Date();
                return (
                  <div className="card" key={p.id}>
                    <h3>{bonoName(bonos, p.bonoId)}{p.trimestre && ' · Trimestre'} <span className="pill pill-lav">{p.paymentMethod === 'redsys' ? 'Tarjeta' : 'Bizum'}</span></h3>
                    <p className="muted">{s ? s.name : 'Alumna eliminada'} · {s ? s.phone : ''}</p>
                    <p className="muted">Clases: <b>{p.classesTotal === null ? 'Ilimitadas' : `${p.classesUsed || 0} de ${p.classesTotal} usadas`}</b></p>
                    <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
                      <span className={`pill ${vencido ? 'pill-gray' : 'pill-sage'}`}>{vencido ? 'Caducado' : `Válido hasta ${fmtDate(new Date(p.expiryDate))}`}</span>
                      <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => {
                        if (!confirm(`¿Cancelar el bono ${bonoName(bonos, p.bonoId)} de ${s ? s.name : 'esta alumna'}? Dejará de estar activo.`)) return;
                        savePurchases(purchases.map(x => x.id === p.id ? { ...x, status: 'cancelado' } : x));
                        toast('Bono cancelado');
                      }}>Cancelar bono</button>
                    </div>
                  </div>
                );
              })}
          <div className="sectionlabel">Clases sueltas confirmadas</div>
          {bookings.filter(b => b.status === 'confirmada' && b.paymentMethod !== 'bono').length === 0 ? <div className="empty">Todavía no hay clases sueltas confirmadas.</div> :
            [...bookings].filter(b => b.status === 'confirmada' && b.paymentMethod !== 'bono')
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map(b => {
                const s = students.find(x => x.id === b.studentId);
                return (
                  <div className="card" key={b.id}>
                    <h3>{b.className} <span className="pill pill-lav">{b.paymentMethod === 'redsys' ? 'Tarjeta' : 'Bizum'}</span></h3>
                    <p className="muted">{s ? s.name : 'Alumna eliminada'} · {fmtDate(new Date(b.date))} {b.time}</p>
                    <button className="linklike" style={{ color: 'var(--danger)', marginTop: 6 }} onClick={() => {
                      if (!confirm(`¿Cancelar esta clase de ${s ? s.name : 'esta alumna'}?`)) return;
                      saveBookings(bookings.map(x => x.id === b.id ? { ...x, status: 'cancelada' } : x));
                      toast('Clase cancelada');
                    }}>Cancelar</button>
                  </div>
                );
              })}
        </>
      )}
      {adminTab === 'horarios' && <AdminHorarios schedule={schedule} saveSchedule={saveSchedule} toast={toast} />}
      {adminTab === 'gestionbonos' && <AdminBonos bonos={bonos} saveBonos={saveBonos} toast={toast} />}
      {adminTab === 'muro' && <AdminMuro wallPosts={wallPosts} saveWallPosts={saveWallPosts} adminToken={adminToken} toast={toast} />}
      {adminTab === 'importar' && <AdminImport students={students} saveStudents={saveStudents} toast={toast} />}
    </>
  );
}

function AdminHorarios({ schedule, saveSchedule, toast }) {
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  function updateDay(day, classes) {
    saveSchedule({ ...schedule, [day]: classes });
  }
  return (
    <>
      {days.map(day => (
        <AdminHorarioDay key={day} day={day} classes={schedule[day] || []} onChange={(next) => updateDay(day, next)} />
      ))}
    </>
  );
}

function AdminHorarioDay({ day, classes, onChange }) {
  const [editing, setEditing] = useState(null); // índice en edición, o 'new'
  const [time, setTime] = useState('');
  const [name, setName] = useState('');

  function startAdd() { setEditing('new'); setTime(''); setName(''); }
  function startEdit(i) { setEditing(i); setTime(classes[i].time); setName(classes[i].name); }
  function cancel() { setEditing(null); }
  function save() {
    if (!time.trim() || !name.trim()) return;
    let next;
    if (editing === 'new') next = [...classes, { time: time.trim(), name: name.trim() }];
    else next = classes.map((c, i) => i === editing ? { time: time.trim(), name: name.trim() } : c);
    next = [...next].sort((a, b) => a.time.localeCompare(b.time));
    onChange(next);
    setEditing(null);
  }
  function remove(i) {
    if (!confirm(`¿Eliminar ${classes[i].name} (${classes[i].time}) de ${day}?`)) return;
    onChange(classes.filter((_, x) => x !== i));
  }

  return (
    <div className="card">
      <h3>{day}</h3>
      {classes.length === 0 && editing === null && <p className="muted">Sin clases este día.</p>}
      {classes.map((c, i) => editing === i ? (
        <div key={i} className="row" style={{ marginTop: 8, alignItems: 'center' }}>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ width: 110, flex: 'none' }} />
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la clase" style={{ width: 'auto', flex: 1 }} />
          <button className="btn btn-sage btn-sm" onClick={save}>Guardar</button>
          <button className="linklike" onClick={cancel}>Cancelar</button>
        </div>
      ) : (
        <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span>{c.time} · {c.name}</span>
          <div className="row">
            <button className="linklike" onClick={() => startEdit(i)}>Editar</button>
            <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => remove(i)}>Eliminar</button>
          </div>
        </div>
      ))}
      {editing === 'new' ? (
        <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ width: 110, flex: 'none' }} />
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la clase" style={{ width: 'auto', flex: 1 }} />
          <button className="btn btn-sage btn-sm" onClick={save}>Añadir</button>
          <button className="linklike" onClick={cancel}>Cancelar</button>
        </div>
      ) : (
        <button className="linklike" style={{ marginTop: 10 }} onClick={startAdd}>+ Añadir clase</button>
      )}
    </div>
  );
}

function BonoForm({ form, setForm, onSave, onCancel }) {
  return (
    <>
      <label>Nombre</label>
      <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej. Bono 15" />
      <label>Descripción</label>
      <input type="text" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} placeholder="Ej. 15 clases al mes" />
      <label>Precio (€)</label>
      <input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="130" />
      <label>Nº de clases al mes (vacío = ilimitadas)</label>
      <input type="number" value={form.classes} onChange={e => setForm({ ...form, classes: e.target.value })} placeholder="15" />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-sage btn-sm" onClick={onSave}>Guardar</button>
        <button className="linklike" onClick={onCancel}>Cancelar</button>
      </div>
    </>
  );
}

function AdminBonos({ bonos, saveBonos, toast }) {
  const [editing, setEditing] = useState(null); // id en edición, o 'new'
  const [form, setForm] = useState({ name: '', desc: '', price: '', classes: '' });

  function startAdd() { setEditing('new'); setForm({ name: '', desc: '', price: '', classes: '' }); }
  function startEdit(b) { setEditing(b.id); setForm({ name: b.name, desc: b.desc, price: String(b.price), classes: b.classes === null ? '' : String(b.classes) }); }
  function cancel() { setEditing(null); }
  function save() {
    if (!form.name.trim() || !form.price) { toast('Nombre y precio son obligatorios'); return; }
    const classesVal = form.classes.trim() === '' ? null : Number(form.classes);
    const bonoData = { name: form.name.trim(), desc: form.desc.trim(), price: Number(form.price), classes: classesVal };
    let next;
    if (editing === 'new') next = [...bonos, { id: uid(), ...bonoData }];
    else next = bonos.map(b => b.id === editing ? { ...b, ...bonoData } : b);
    saveBonos(next);
    setEditing(null);
    toast(editing === 'new' ? 'Bono añadido' : 'Bono actualizado');
  }
  function remove(b) {
    if (!confirm(`¿Eliminar ${b.name}? Las alumnas que ya lo tengan contratado no se ven afectadas.`)) return;
    saveBonos(bonos.filter(x => x.id !== b.id));
    toast('Bono eliminado');
  }

  return (
    <>
      {bonos.map(b => (
        <div className="card" key={b.id}>
          {editing === b.id ? (
            <BonoForm form={form} setForm={setForm} onSave={save} onCancel={cancel} />
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3>{b.name}</h3>
                  <p className="muted">{b.desc}</p>
                </div>
                <div className="serif" style={{ fontSize: 17, fontWeight: 600, color: 'var(--plum)' }}>{b.price}€</div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="linklike" onClick={() => startEdit(b)}>Editar</button>
                <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => remove(b)}>Eliminar</button>
              </div>
            </>
          )}
        </div>
      ))}
      <div className="card">
        {editing === 'new' ? (
          <BonoForm form={form} setForm={setForm} onSave={save} onCancel={cancel} />
        ) : (
          <button className="btn btn-primary" onClick={startAdd}>+ Añadir bono nuevo</button>
        )}
      </div>
    </>
  );
}

function AdminResumen({ students, bookings, saveBookings, schedule, toast }) {
  const [offset, setOffset] = useState(0);
  const date = addDays(new Date(), offset);
  const dateIso = isoDate(date);
  const dayName = Object.keys(DAY_INDEX).find(k => DAY_INDEX[k] === date.getDay());
  const classes = schedule[dayName] || [];

  return (
    <>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setOffset(offset - 1)}>← Anterior</button>
        <div style={{ textAlign: 'center' }}>
          <div className="serif" style={{ fontWeight: 600, fontSize: 17 }}>{fmtDate(date)}</div>
          {offset !== 0 && <button className="linklike" onClick={() => setOffset(0)}>Volver a hoy</button>}
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => setOffset(offset + 1)}>Siguiente →</button>
      </div>
      {classes.length === 0 ? (
        <div className="empty">No hay clases programadas este día.</div>
      ) : classes.map((c, idx) => (
        <AdminResumenClass key={idx} cls={c} dateIso={dateIso} students={students} bookings={bookings}
          saveBookings={saveBookings} toast={toast} />
      ))}
    </>
  );
}

function AdminResumenClass({ cls: c, dateIso, students, bookings, saveBookings, toast }) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [payMethod, setPayMethod] = useState('efectivo');
  const attendees = bookings.filter(b => b.date === dateIso && b.time === c.time && b.className === c.name && b.status !== 'cancelada');
  const full = attendees.length >= CLASS_CAPACITY;

  const q = search.trim().toLowerCase();
  const matches = q.length < 2 ? [] : students.filter(s =>
    (s.name || '').toLowerCase().includes(q) || (s.phone || '').toLowerCase().includes(q)
  ).filter(s => !attendees.some(b => b.studentId === s.id)).slice(0, 6);

  function addStudent(s) {
    const booking = {
      id: uid(), studentId: s.id, day: dayNameForDate(new Date(dateIso)), time: c.time, className: c.name,
      date: dateIso, status: 'confirmada', paymentMethod: payMethod, price: CLASE_SUELTA_PRECIO,
      createdAt: new Date().toISOString()
    };
    saveBookings([...bookings, booking]);
    setAdding(false);
    setSearch('');
    toast(`${s.name} añadida a ${c.name} (${payMethod})`);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div className="time">{c.time}</div>
          <div className="name">{c.name}</div>
        </div>
        <span className="pill pill-lav">{attendees.length} apuntada{attendees.length === 1 ? '' : 's'}</span>
      </div>
      {attendees.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          {attendees.map(b => {
            const s = students.find(x => x.id === b.studentId);
            return (
              <li key={b.id} className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, listStyle: 'none', marginLeft: -18, marginBottom: 4 }}>
                <span>{s ? s.name : 'Alumna eliminada'}</span>
                {b.status === 'pendiente_pago' && <span className="pill pill-gray">Pago pendiente</span>}
                {b.paymentMethod === 'efectivo' && <span className="pill pill-sage">Efectivo</span>}
                {b.paymentMethod === 'transferencia' && <span className="pill pill-sage">Transferencia</span>}
                <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => {
                  saveBookings(bookings.map(x => x.id === b.id ? { ...x, status: 'cancelada' } : x));
                  toast('Reserva cancelada');
                }}>Cancelar</button>
              </li>
            );
          })}
        </ul>
      )}
      {full ? (
        <p className="muted" style={{ marginTop: 10 }}>Clase completa, no se puede añadir a nadie más.</p>
      ) : adding ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ marginBottom: 8 }}>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
          </select>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar alumna por nombre o teléfono…" autoFocus />
          {q.length >= 2 && matches.length === 0 && <p className="muted" style={{ marginTop: 6 }}>Sin resultados.</p>}
          {matches.map(s => (
            <div key={s.id} className="optionbox" style={{ marginTop: 8 }} onClick={() => addStudent(s)}>
              <div className="t">{s.name}</div>
              <div className="s">{s.phone}</div>
            </div>
          ))}
          <button className="linklike" style={{ marginTop: 8 }} onClick={() => { setAdding(false); setSearch(''); }}>Cancelar</button>
        </div>
      ) : (
        <button className="linklike" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>+ Añadir alumna (efectivo)</button>
      )}
    </div>
  );
}

function AdminMuro({ wallPosts, saveWallPosts, adminToken, toast }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);

  async function handleImagePick(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const url = await uploadWallImage(file);
      setImageUrl(url);
    } catch (err) {
      toast(err.message || 'No se pudo subir la imagen');
      setImagePreview(null);
    }
    setUploading(false);
  }

  function removeImage() {
    if (imageUrl) deleteWallImage(imageUrl, adminToken);
    setImageUrl(null);
    setImagePreview(null);
  }

  return (
    <>
      <div className="card">
        <label>Título</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej. Clase especial de luna llena" />
        <label>Mensaje</label>
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Escribe el aviso para todas las alumnas" />
        <label>Foto (opcional)</label>
        {imagePreview ? (
          <div style={{ position: 'relative', marginTop: 6 }}>
            <img src={imagePreview} alt="" className="postimg" style={{ opacity: uploading ? 0.5 : 1 }} />
            {uploading && <div className="muted" style={{ marginTop: 6 }}>Subiendo imagen…</div>}
            {!uploading && <button className="linklike" style={{ color: 'var(--danger)', marginTop: 6 }} onClick={removeImage}>Quitar foto</button>}
          </div>
        ) : (
          <input type="file" accept="image/*" onChange={handleImagePick} />
        )}
        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={uploading} onClick={() => {
          if (!title.trim() || !content.trim()) { toast('Escribe un título y un mensaje'); return; }
          saveWallPosts([...wallPosts, { id: uid(), title: title.trim(), content: content.trim(), imageUrl: imageUrl || null, date: new Date().toISOString() }]);
          setTitle(''); setContent(''); setImageUrl(null); setImagePreview(null);
          toast('Publicado en el muro, avisando a las alumnas…');
          fetch('/api/notify-wall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title.trim(), body: content.trim() })
          }).catch(() => {});
        }}>Publicar en el muro</button>
      </div>
      <div className="sectionlabel">Publicaciones</div>
      {[...wallPosts].sort((a, b) => new Date(b.date) - new Date(a.date)).map(p => (
        <div className="card postcard" key={p.id}>
          <div className="postdate">{fmtDate(new Date(p.date))}</div>
          <h3>{p.title}</h3>
          {p.imageUrl && <img src={p.imageUrl} alt="" className="postimg" />}
          <p>{p.content}</p>
          <button className="linklike" style={{ color: 'var(--danger)', marginTop: 8 }}
            onClick={() => {
              if (!confirm('¿Seguro que quieres eliminar esta publicación del muro?')) return;
              if (p.imageUrl) deleteWallImage(p.imageUrl, adminToken);
              saveWallPosts(wallPosts.filter(x => x.id !== p.id));
            }}>Eliminar</button>
        </div>
      ))}
    </>
  );
}

/* ---------------- MODALES ---------------- */
function BookingModal({ modal, bookings, saveBookings, purchases, savePurchases, bonos, me, pickProfile, activePurchaseFor, toast, onClose }) {
  const { day, cls, dateIso } = modal;

  function confirmBookingWithBono(purchaseId) {
    const next = purchases.map(p => p.id === purchaseId ? { ...p, classesUsed: (p.classesUsed || 0) + (p.classesTotal === null ? 0 : 1) } : p);
    savePurchases(next);
    saveBookings([...bookings, { id: uid(), studentId: me.id, day, time: cls.time, className: cls.name, date: dateIso, status: 'confirmada', paymentMethod: 'bono', createdAt: new Date().toISOString() }]);
    toast('Clase reservada con tu bono');
    onClose();
  }
  function confirmBookingSuelta(studentId) {
    const booking = { id: uid(), studentId, day, time: cls.time, className: cls.name, date: dateIso, status: 'pendiente_pago', paymentMethod: 'bizum', price: CLASE_SUELTA_PRECIO, createdAt: new Date().toISOString() };
    saveBookings([...bookings, booking]);
    toast(`Reserva registrada. Haz el Bizum al ${BIZUM_PHONE} y Beatriz lo confirmará`);
    onClose();
    return booking;
  }
  async function confirmBookingSueltaCard(studentId) {
    const booking = { id: uid(), studentId, day, time: cls.time, className: cls.name, date: dateIso, status: 'pendiente_pago', paymentMethod: 'redsys', price: CLASE_SUELTA_PRECIO, createdAt: new Date().toISOString() };
    saveBookings([...bookings, booking]);
    try {
      await payWithRedsys({ kind: 'suelta', itemId: booking.id, studentId, amount: CLASE_SUELTA_PRECIO, concept: `${cls.name} (${day} ${cls.time})` });
    } catch (e) {
      toast('No se pudo iniciar el pago con tarjeta. Puedes pagar por Bizum.');
    }
  }

  let step2 = null;
  if (dateIso) {
    const attendeeCount = bookings.filter(b => b.date === dateIso && b.time === cls.time && b.className === cls.name && b.status !== 'cancelada').length;
    const full = attendeeCount >= CLASS_CAPACITY;
    if (me) {
      const already = bookings.some(b => b.studentId === me.id && b.date === dateIso && b.time === cls.time && b.className === cls.name && b.status !== 'cancelada');
      if (already) {
        step2 = <p className="muted" style={{ marginTop: 12 }}>Ya tienes esta clase reservada ese día.</p>;
      } else if (full) {
        step2 = <p className="muted" style={{ marginTop: 12 }}>Esta clase ya está completa (máximo {CLASS_CAPACITY} alumnas). Elige otra fecha.</p>;
      } else {
        const active = activePurchaseFor(me.id, new Date(dateIso));
        step2 = (
          <>
            <hr className="sep" />
            {active ? (
              <div className="optionbox" onClick={() => confirmBookingWithBono(active.id)}>
                <div className="t">Usar mi {bonoName(bonos, active.bonoId)}</div>
                <div className="s">Clases {active.classesTotal === null ? 'ilimitadas' : `${active.classesTotal - active.classesUsed} restantes`}</div>
              </div>
            ) : <p className="muted">No tienes un bono activo para esta fecha.</p>}
            <div className="optionbox" onClick={() => confirmBookingSueltaCard(me.id)}>
              <div className="t">Pagar con tarjeta ahora · {CLASE_SUELTA_PRECIO}€</div>
              <div className="s">Redirige a la pasarela de pago segura</div>
            </div>
            <div className="optionbox" onClick={() => confirmBookingSuelta(me.id)}>
              <div className="t">Pagar por Bizum · {CLASE_SUELTA_PRECIO}€</div>
              <div className="s">Al {BIZUM_PHONE} — Beatriz lo confirma en cuanto lo recibe</div>
            </div>
          </>
        );
      }
    } else if (full) {
      step2 = (
        <>
          <hr className="sep" />
          <p className="muted">Esta clase ya está completa (máximo {CLASS_CAPACITY} alumnas). Elige otra fecha.</p>
        </>
      );
    } else {
      step2 = (
        <NoProfileBookingStep
          dateIso={dateIso}
          pickProfile={pickProfile} toast={toast}
          onConfirmPuntual={(quickId) => confirmBookingSuelta(quickId)}
          onConfirmPuntualCard={(quickId) => confirmBookingSueltaCard(quickId)}
        />
      );
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>{cls.name} · {cls.time}</h3>
        <p className="muted">{fmtDate(new Date(dateIso))}</p>
        {step2}
      </div>
    </div>
  );
}

function NoProfileBookingStep({ dateIso, pickProfile, toast, onConfirmPuntual, onConfirmPuntualCard }) {
  const [path, setPath] = useState(null);
  const [searchPhone, setSearchPhone] = useState('');
  const [searchMsg, setSearchMsg] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  async function makeQuickStudent() {
    const quick = { id: uid(), name: name.trim(), email: '', phone: phone.trim(), birthday: '', howFound: '', isPuntual: true, createdAt: new Date().toISOString() };
    const saved = await upsertStudent(quick);
    return saved || quick;
  }

  return (
    <>
      <hr className="sep" />
      <p className="muted">Esta clase se paga como clase suelta ({CLASE_SUELTA_PRECIO}€). ¿Cómo quieres reservarla?</p>
      <div className="optionbox" onClick={() => setPath('perfil')}>
        <div className="t">Ya tengo perfil</div>
        <div className="s">Buscar mis datos por teléfono</div>
      </div>
      <div className="optionbox" onClick={() => setPath('puntual')}>
        <div className="t">Es algo puntual, sin perfil</div>
        <div className="s">Solo pido tu nombre y teléfono</div>
      </div>
      {path === 'perfil' && (
        <>
          <label>Teléfono</label>
          <input type="tel" value={searchPhone} onChange={e => setSearchPhone(e.target.value)} placeholder="600123456" />
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={async () => {
            setBusy(true);
            const found = await findStudent({ phone: searchPhone });
            setBusy(false);
            if (found) { pickProfile(found.id); toast(`Perfil encontrado, ¡hola ${found.name.split(' ')[0]}!`); }
            else setSearchMsg('No encontramos ese teléfono.');
          }}>{busy ? 'Buscando…' : 'Buscar'}</button>
          {searchMsg && <div className="muted" style={{ marginTop: 8 }}>{searchMsg}</div>}
        </>
      )}
      {path === 'puntual' && (
        <>
          <label>Nombre</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellidos" />
          <label>Teléfono (con prefijo de país)</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34600123456" />
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10, marginRight: 8 }} disabled={busy} onClick={async () => {
            if (!name.trim() || !phone.trim()) { toast('Nombre y teléfono son obligatorios'); return; }
            if (!isValidIntlPhone(phone)) { toast('El teléfono debe incluir el prefijo del país, ej. +34600123456'); return; }
            setBusy(true);
            const quick = await makeQuickStudent();
            setBusy(false);
            onConfirmPuntualCard(quick.id);
          }}>Pagar con tarjeta</button>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={async () => {
            if (!name.trim() || !phone.trim()) { toast('Nombre y teléfono son obligatorios'); return; }
            if (!isValidIntlPhone(phone)) { toast('El teléfono debe incluir el prefijo del país, ej. +34600123456'); return; }
            setBusy(true);
            const quick = await makeQuickStudent();
            setBusy(false);
            onConfirmPuntual(quick.id);
          }}>Pagar por Bizum al {BIZUM_PHONE}</button>
        </>
      )}
    </>
  );
}

function BonoModal({ modal, me, purchases, savePurchases, toast, onClose }) {
  const b = modal.bono;
  const trimestre = !!modal.trimestre;
  const tri = BONO_TRIMESTRE[b.id];
  const price = trimestre && tri ? tri.price : b.price;
  const classesTotal = b.classes === null ? null : (trimestre ? b.classes * 3 : b.classes);
  const termDays = trimestre ? 90 : 30;
  const label = trimestre ? `${b.name} · Trimestre` : b.name;
  const [paying, setPaying] = useState(false);

  function createPendingPurchase(paymentMethod) {
    const purchase = {
      id: uid(), studentId: me.id, bonoId: b.id, price, trimestre,
      classesTotal, classesUsed: 0,
      status: 'pendiente', paymentMethod, purchaseDate: new Date().toISOString(), expiryDate: addDays(new Date(), termDays).toISOString()
    };
    savePurchases([...purchases, purchase]);
    return purchase;
  }

  async function handleCardPayment() {
    setPaying(true);
    const purchase = createPendingPurchase('redsys');
    try {
      await payWithRedsys({ kind: 'bono', itemId: purchase.id, studentId: me.id, amount: price, concept: label });
    } catch (e) {
      setPaying(false);
      toast('No se pudo iniciar el pago con tarjeta. Puedes pagar por Bizum.');
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>{label}</h3>
        <p className="muted">{b.desc}{trimestre && ' · pago único de 3 meses'} · <b>{price}€</b></p>
        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={paying} onClick={handleCardPayment}>
          {paying ? 'Redirigiendo a la pasarela…' : 'Pagar con tarjeta ahora'}
        </button>
        <p className="muted" style={{ textAlign: 'center', margin: '10px 0' }}>o</p>
        <button className="btn btn-ghost" onClick={() => {
          createPendingPurchase('bizum');
          toast(`Bono solicitado. Haz el Bizum al ${BIZUM_PHONE} y Beatriz lo confirmará`);
          onClose();
        }}>Pagar por Bizum al {BIZUM_PHONE}</button>
      </div>
    </div>
  );
}

/* ---------------- IMPORTAR ALUMNAS (Excel) ---------------- */
const HOWFOUND_IMPORT_MAP = {
  'Recomendación': 'Recomendación de una amiga',
  'Recomendacion': 'Recomendación de una amiga',
  'Al pasar por el centro': 'Al pasar por el centro',
  'Otro': 'Otro',
  'Google': 'Google',
  'Instagram': 'Instagram',
  'Facebook': 'Facebook'
};

function excelDateToIso(value) {
  if (!value) return '';
  if (value instanceof Date) return isoDate(value);
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function excelCreatedToIso(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`).toISOString();
  return new Date().toISOString();
}

function looksLikeTestRow(nombre, apellidos) {
  const s = `${nombre} ${apellidos}`.toLowerCase();
  return s.includes('prueba') || s.includes('test');
}

function AdminImport({ students, saveStudents, toast }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const existingPhones = new Set(students.map(s => String(s.phone).replace(/\s/g, '')));
        const parsed = json.map((row, i) => {
          const nombre = String(row['Nombre'] || '').trim();
          const apellidos = String(row['Apellidos'] || '').trim();
          const phoneRaw = String(row['Teléfono'] || '').trim();
          const isTest = looksLikeTestRow(nombre, apellidos);
          const isDuplicate = phoneRaw && existingPhones.has(phoneRaw.replace(/\s/g, ''));
          const howFoundRaw = String(row['¿Cómo nos has conocido?'] || '').trim();
          const legacyReservas = Number(row['Reservas finalizadas']) || 0;
          return {
            key: i,
            name: `${nombre} ${apellidos}`.trim(),
            email: String(row['Correo'] || '').trim(),
            phone: phoneRaw,
            birthday: excelDateToIso(row['Fecha de Nacimiento']),
            howFound: HOWFOUND_IMPORT_MAP[howFoundRaw] || howFoundRaw,
            createdAt: excelCreatedToIso(row['Creado el']),
            legacyReservas,
            isTest,
            isDuplicate,
            selected: !isTest && !isDuplicate
          };
        });
        setRows(parsed);
      } catch (err) {
        toast('No se pudo leer el archivo. ¿Es un Excel válido?');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function toggleRow(key) {
    setRows(rows.map(r => r.key === key ? { ...r, selected: !r.selected } : r));
  }

  function handleImport() {
    const toImport = rows.filter(r => r.selected);
    if (toImport.length === 0) { toast('No hay ninguna fila seleccionada'); return; }
    const newStudents = toImport.map(r => ({
      id: uid(), name: r.name, email: r.email, phone: r.phone, birthday: r.birthday,
      howFound: r.howFound, legacyReservas: r.legacyReservas, createdAt: r.createdAt
    }));
    saveStudents([...students, ...newStudents]);
    toast(`${newStudents.length} alumnas importadas`);
    setRows(null);
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const selectedCount = rows ? rows.filter(r => r.selected).length : 0;

  return (
    <>
      <div className="card">
        <h3>Importar alumnas desde Excel</h3>
        <p className="muted">Sube el archivo exportado de tu app anterior (mismas columnas: Nombre, Apellidos, Teléfono, Correo, Fecha de Nacimiento, ¿Cómo nos has conocido?...). Solo se importan nombre, email, teléfono, cumpleaños y cómo os conoció — el resto de columnas no se usan.</p>
        <input type="file" accept=".xlsx,.xls" ref={fileInputRef} onChange={handleFile} style={{ marginTop: 10 }} />
      </div>

      {rows && (
        <>
          <div className="sectionlabel">{fileName} · {rows.length} filas encontradas · {selectedCount} seleccionadas</div>
          {rows.map(r => (
            <div key={r.key} className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, opacity: r.selected ? 1 : 0.5 }}>
              <input type="checkbox" checked={r.selected} onChange={() => toggleRow(r.key)} style={{ width: 'auto', marginTop: 3 }} />
              <div style={{ flex: 1 }}>
                <h3>{r.name || '(sin nombre)'}</h3>
                <p className="muted">{r.phone} · {r.email || 'sin email'}</p>
                <p className="muted">Cumpleaños: {r.birthday || '—'} · Conoció por: {r.howFound || '—'}</p>
                <div className="row" style={{ marginTop: 6 }}>
                  {r.isTest && <span className="pill pill-danger">Parece de prueba</span>}
                  {r.isDuplicate && <span className="pill pill-peach">Ya existe (mismo teléfono)</span>}
                  {r.legacyReservas > 0 && <span className="pill pill-gray">{r.legacyReservas} reservas históricas</span>}
                </div>
              </div>
            </div>
          ))}
          <button className="btn btn-primary" style={{ marginTop: 10, marginBottom: 20 }} onClick={handleImport}>
            Importar {selectedCount} alumnas seleccionadas
          </button>
        </>
      )}
    </>
  );
}
