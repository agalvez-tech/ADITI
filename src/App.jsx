import React, { useState, useEffect, useRef, useContext } from 'react';
import * as XLSX from 'xlsx';
import { getData, setData, adminLogin, findStudent, upsertStudent, changeAdminPin } from './api.js';
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

// trimestrePrice: precio de pago único por 3 meses (opcional). Si no se pone,
// ese bono simplemente no ofrece opción de trimestre.
const DEFAULT_BONOS = [
  { id: 'bono4', name: 'Bono 4', desc: '4 clases al mes · 1 día a la semana', price: 60, classes: 4, trimestrePrice: 165 },
  { id: 'bono6', name: 'Bono 6', desc: '6 clases al mes · ≥2 días a la semana', price: 80, classes: 6, trimestrePrice: 220 },
  { id: 'bono8', name: 'Bono 8', desc: '8 clases al mes · 2 días a la semana', price: 95, classes: 8, trimestrePrice: 260 },
  { id: 'bono10', name: 'Bono 10', desc: '10 clases al mes', price: 105, classes: 10, trimestrePrice: 285 },
  { id: 'bono12', name: 'Bono 12', desc: '12 clases al mes · 3 días a la semana', price: 120, classes: 12, trimestrePrice: 325 },
  { id: 'ilimitado', name: 'Bono ilimitado', desc: 'Clases ilimitadas', price: 150, classes: null, trimestrePrice: 405 }
];
const DEFAULT_SETTINGS = { claseSueltaPrice: 20, bizumPhone: '691750534', whatsappPhone: '34652689928', defaultCapacity: 8, freezePrice: 3, freezeMaxDays: 30 };
const SettingsContext = React.createContext(DEFAULT_SETTINGS);
const FreezeContext = React.createContext({ freezes: [], saveFreezes: () => {} });
function bonoTrimestre(b) {
  if (!b || !b.trimestrePrice) return null;
  return { price: b.trimestrePrice, ahorro: b.price * 3 - b.trimestrePrice };
}
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
// Una reserva 'en_espera' (lista de espera) no ocupa plaza real de la clase.
function occupiesSpot(status) { return status !== 'cancelada' && status !== 'en_espera'; }
function toMinutes(t) { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); }
function slotDuration(c) { return c.duration || 60; }
const STATUS_LABELS = { confirmada: 'Confirmada', pendiente_pago: 'Pendiente de pago', cancelada: 'Cancelada', en_espera: 'En lista de espera' };
const RECURRING_WEEKS = 10; // nº de semanas que se crean de golpe al añadir una alumna "fija"
function isHoliday(holidays, dateIso) { return (holidays || []).find(h => h.date === dateIso); }
// Cancelación puntual de UNA clase en UN día concreto (el horario semanal no cambia).
function isClassCancelled(classCancellations, dateIso, time, className) {
  return (classCancellations || []).some(c => c.date === dateIso && c.time === time && c.className === className);
}
// Usa la hora local del dispositivo (la de la propia alumna), que para este
// uso es más fiable que calcularlo en el servidor con otro huso horario.
function isPastSlot(dateIso, time) { return new Date(`${dateIso}T${time}`).getTime() < Date.now(); }
// Las clases del horario solo se pueden reservar con un máximo de 7 días de
// antelación (si hoy es miércoles, como muy tarde el miércoles siguiente).
const BOOKING_WINDOW_DAYS = 7;
function isTooFarAhead(dateIso) { return dateIso > isoDate(addDays(new Date(), BOOKING_WINDOW_DAYS)); }

// Congelación de bono: mientras dura, el bono no se puede usar y su caducidad
// ya se ha alargado los mismos días (al confirmarse la congelación).
function isFrozenOn(freezes, purchaseId, dateIso) {
  return (freezes || []).some(f => f.purchaseId === purchaseId && f.status === 'confirmado' && f.startDate <= dateIso && dateIso <= f.endDate);
}
function freezesOf(freezes, purchaseId) {
  return (freezes || []).filter(f => f.purchaseId === purchaseId && f.status !== 'cancelado').sort((a, b) => a.startDate.localeCompare(b.startDate));
}
function freezeDays(startIso, endIso) {
  return Math.round((new Date(`${endIso}T12:00:00`) - new Date(`${startIso}T12:00:00`)) / 86400000) + 1;
}
function fmtIso(dateIso) { return fmtDate(new Date(`${dateIso}T12:00:00`)); }
// Reservas con bono que quedan dentro del periodo congelado (solo futuras).
function bookingsInFreeze(bookings, freeze) {
  const todayIso = isoDate(new Date());
  return bookings.filter(b => b.studentId === freeze.studentId && b.paymentMethod === 'bono' && occupiesSpot(b.status)
    && b.date >= todayIso && b.date >= freeze.startDate && b.date <= freeze.endDate && (!b.purchaseId || b.purchaseId === freeze.purchaseId));
}
// Aplica una congelación confirmada: alarga la caducidad del bono y cancela
// (devolviendo la clase al bono) las reservas con bono de esos días.
function applyFreeze(freeze, purchases, bookings) {
  const toCancel = bookingsInFreeze(bookings, freeze);
  let nextPurchases = purchases.map(p => p.id === freeze.purchaseId ? { ...p, expiryDate: addDays(new Date(p.expiryDate), freeze.days).toISOString() } : p);
  toCancel.forEach(b => {
    const purchase = findBonoPurchaseForBooking(b, nextPurchases);
    if (purchase) nextPurchases = nextPurchases.map(p => p.id === purchase.id ? { ...p, classesUsed: Math.max(0, (p.classesUsed || 0) - 1) } : p);
  });
  const nextBookings = bookings.map(b => toCancel.some(x => x.id === b.id) ? { ...b, status: 'cancelada' } : b);
  return { nextPurchases, nextBookings, cancelled: toCancel.length };
}

// Cancelar con menos de estas horas de antelación no devuelve la clase al bono.
const LATE_CANCEL_HOURS = 3;
function classDateTime(b) { return new Date(`${b.date}T${b.time}`); }
function isLateCancel(b) { return (classDateTime(b) - new Date()) / 3600000 < LATE_CANCEL_HOURS; }

// Encuentra el bono del que hay que devolver la clase al cancelar. Las
// reservas creadas antes de guardar 'purchaseId' en la propia reserva no
// tienen ese enlace directo; para esas usamos como mejor aproximación el
// bono de la alumna que estuviera vigente en la fecha de la clase.
function findBonoPurchaseForBooking(b, purchases) {
  if (b.purchaseId) {
    const p = purchases.find(p => p.id === b.purchaseId);
    if (p) return p;
  }
  const onDate = new Date(`${b.date}T12:00:00`);
  return purchases
    .filter(p => p.studentId === b.studentId && p.status === 'confirmado' && p.classesTotal !== null && new Date(p.expiryDate) >= onDate)
    .sort((a, x) => new Date(a.expiryDate) - new Date(x.expiryDate))[0] || null;
}

// Cancela una reserva. Si se pagó con bono y se cancela con menos de
// LATE_CANCEL_HOURS de antelación, la clase se queda descontada del bono
// (penalización); con más antelación, se le devuelve la clase al bono. La
// penalización es solo para cuando cancela la propia alumna: si cancela
// Beatriz (forceRefund) siempre se devuelve la clase, sea cual sea la
// antelación, porque la responsable de la cancelación no es la alumna.
// Devuelve true si ha sido una cancelación tardía (para avisar al usuario).
function cancelBookingAndRefund(b, bookings, saveBookings, purchases, savePurchases, { forceRefund } = {}) {
  const late = !forceRefund && isLateCancel(b);
  saveBookings(bookings.map(x => x.id === b.id ? { ...x, status: 'cancelada' } : x));
  if (!late && b.paymentMethod === 'bono' && purchases && savePurchases) {
    const purchase = findBonoPurchaseForBooking(b, purchases);
    if (purchase) {
      savePurchases(purchases.map(p => p.id === purchase.id ? { ...p, classesUsed: Math.max(0, (p.classesUsed || 0) - 1) } : p));
    }
  }
  return late;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('muro');
  const [students, setStudents] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [wallPosts, setWallPosts] = useState([]);
  const [polls, setPolls] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [events, setEvents] = useState([]);
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [classCancellations, setClassCancellations] = useState([]);
  const [punctualClasses, setPunctualClasses] = useState([]);
  const [freezes, setFreezes] = useState([]);
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [bonos, setBonos] = useState(DEFAULT_BONOS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
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
        isAdmin ? getData('scheduledPosts', adminToken) : Promise.resolve(null),
        getData('bookings'), getData('purchases'), getData('wallPosts'), getData('polls'),
        getData('schedule'), getData('bonos'), getData('settings'), getData('holidays'), getData('events'), getData('classCancellations'), getData('punctualClasses'), getData('freezes')
      ]).then(([s, sp, b, p, w, pl, sch, bo, cfg, hol, ev, cc, pc, fz]) => {
        if (cancelled) return;
        if (isAdmin) setStudents(s || []);
        if (isAdmin) setScheduledPosts(sp || []);
        setBookings(b || []);
        setPurchases(p || []);
        setWallPosts(w || []);
        setPolls(pl || []);
        setHolidays(hol || []);
        setEvents(ev || []);
        setClassCancellations(cc || []);
        setPunctualClasses(pc || []);
        setFreezes(fz || []);
        if (sch) setSchedule(sch);
        if (bo) setBonos(bo);
        if (cfg) setSettings({ ...DEFAULT_SETTINGS, ...cfg });
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
  function savePolls(next) { setPolls(next); setData('polls', next, adminToken); }
  function saveHolidays(next) { setHolidays(next); setData('holidays', next, adminToken); }
  function saveEvents(next) { setEvents(next); setData('events', next, adminToken); }
  function saveScheduledPosts(next) { setScheduledPosts(next); setData('scheduledPosts', next, adminToken); }
  function saveClassCancellations(next) { setClassCancellations(next); setData('classCancellations', next, adminToken); }
  function savePunctualClasses(next) { setPunctualClasses(next); setData('punctualClasses', next, adminToken); }
  function saveFreezes(next) { setFreezes(next); setData('freezes', next, adminToken); }
  function saveSchedule(next) { setSchedule(next); setData('schedule', next, adminToken); }
  function saveBonos(next) { setBonos(next); setData('bonos', next, adminToken); }
  function saveSettings(next) { setSettings(next); setData('settings', next, adminToken); }
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
      .filter(p => p.studentId === studentId && p.status === 'confirmado' && new Date(p.expiryDate) >= today && (p.classesTotal === null || p.classesUsed < p.classesTotal)
        && !isFrozenOn(freezes, p.id, isoDate(today)))
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0];
  }

  return (
    <SettingsContext.Provider value={settings}>
    <FreezeContext.Provider value={{ freezes, saveFreezes }}>
    <div className="app-wrap">
      <Header tab={tab} />
      <div className="content">
        {loading ? (
          <div className="empty">Cargando…</div>
        ) : tab === 'muro' ? (
          <MuroTab wallPosts={wallPosts} polls={polls} savePolls={savePolls} me={me} toast={toast} />
        ) : tab === 'horario' ? (
          <HorarioTab
            bookings={bookings} schedule={schedule} holidays={holidays} events={events} classCancellations={classCancellations} punctualClasses={punctualClasses} me={me}
            onPickClass={(cls, dateIso, day) => setModal({ type: 'booking', day, cls, dateIso })}
          />
        ) : tab === 'bonos' ? (
          <BonosTab me={me} activePurchaseFor={activePurchaseFor} purchases={purchases} bonos={bonos}
            events={events} bookings={bookings}
            onRequestBono={(bono, trimestre) => {
              if (!me) { toast('Completa tu perfil antes de solicitar un bono'); setTab('perfil'); return; }
              setModal({ type: 'bono', bono, trimestre });
            }}
            onRequestEvent={(event) => {
              if (!me) { toast('Completa tu perfil antes de apuntarte'); setTab('perfil'); return; }
              setModal({ type: 'event', event });
            }}
            onRequestFreeze={(purchase) => setModal({ type: 'freeze', purchase })} />
        ) : tab === 'perfil' ? (
          <PerfilTab me={me} pickProfile={pickProfile} clearProfile={clearProfile} bonos={bonos}
            purchases={purchases} savePurchases={savePurchases} bookings={bookings} saveBookings={saveBookings} activePurchaseFor={activePurchaseFor}
            isAdmin={isAdmin} onAdminLogin={loginAdmin} onAdminLogout={logoutAdmin} setTab={setTab} toast={toast} />
        ) : tab === 'admin' ? (
          <AdminTab adminTab={adminTab} setAdminTab={setAdminTab}
            students={students} saveStudents={saveStudents} bookings={bookings} purchases={purchases} wallPosts={wallPosts}
            polls={polls} savePolls={savePolls} holidays={holidays} saveHolidays={saveHolidays}
            events={events} saveEvents={saveEvents}
            scheduledPosts={scheduledPosts} saveScheduledPosts={saveScheduledPosts}
            classCancellations={classCancellations} saveClassCancellations={saveClassCancellations}
            punctualClasses={punctualClasses} savePunctualClasses={savePunctualClasses}
            activePurchaseFor={activePurchaseFor} adminToken={adminToken}
            schedule={schedule} saveSchedule={saveSchedule} bonos={bonos} saveBonos={saveBonos}
            settings={settings} saveSettings={saveSettings} onAdminLogout={logoutAdmin}
            savePurchases={savePurchases} saveBookings={saveBookings} saveWallPosts={saveWallPosts}
            toast={toast} />
        ) : null}
      </div>
      <BottomNav tab={tab} setTab={setTab} isAdmin={isAdmin} />
      <a className="wa-float" href={`https://wa.me/${settings.whatsappPhone}?text=Hola%20Beatriz%2C%20te%20escribo%20desde%20la%20app%20de%20Aditi%20Functional%20Yoga`} target="_blank" rel="noopener" aria-label="Escribir por WhatsApp a Beatriz">
        <WaIcon />
      </a>
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {modal && modal.type === 'booking' && (
        <BookingModal
          modal={modal} bonos={bonos} classCancellations={classCancellations}
          bookings={bookings} saveBookings={saveBookings} purchases={purchases} savePurchases={savePurchases}
          me={me} myId={myId} pickProfile={pickProfile} activePurchaseFor={activePurchaseFor}
          toast={toast} onClose={() => setModal(null)}
        />
      )}
      {modal && modal.type === 'bono' && (
        <BonoModal modal={modal} me={me} purchases={purchases} savePurchases={savePurchases}
          toast={toast} onClose={() => setModal(null)} />
      )}
      {modal && modal.type === 'event' && (
        <EventModal modal={modal} me={me} bookings={bookings} saveBookings={saveBookings}
          toast={toast} onClose={() => setModal(null)} />
      )}
      {modal && modal.type === 'freeze' && (
        <FreezeModal modal={modal} me={me} bookings={bookings} toast={toast} onClose={() => setModal(null)} />
      )}
    </div>
    </FreezeContext.Provider>
    </SettingsContext.Provider>
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
function MuroTab({ wallPosts, polls, savePolls, me, toast }) {
  const posts = [...wallPosts].sort((a, b) => new Date(b.date) - new Date(a.date));
  const activePoll = me && (polls || []).find(p => p.active !== false && !(p.votes || []).some(v => v.studentId === me.id));

  return (
    <>
      {activePoll && <PollCard poll={activePoll} me={me} polls={polls} savePolls={savePolls} toast={toast} />}
      {posts.length === 0 ? (
        <div className="empty"><div className="glyph">🌿</div>Todavía no hay novedades.<br />Aquí verás los avisos y eventos de Beatriz.</div>
      ) : posts.map(p => (
        <div className="card postcard" key={p.id}>
          <div className="postdate">{fmtDate(new Date(p.date))}</div>
          <h3>{p.title}</h3>
          {p.imageUrl && <img src={p.imageUrl} alt="" className="postimg" />}
          <p>{p.content}</p>
        </div>
      ))}
    </>
  );
}

function PollCard({ poll, me, polls, savePolls, toast }) {
  const [selected, setSelected] = useState(null);
  const [voted, setVoted] = useState(false);

  function vote() {
    if (!selected) { toast('Elige una opción'); return; }
    const next = polls.map(p => p.id === poll.id
      ? { ...p, votes: [...(p.votes || []), { studentId: me.id, optionId: selected, votedAt: new Date().toISOString() }] }
      : p);
    savePolls(next);
    setVoted(true);
    toast('¡Voto registrado! Gracias por participar.');
  }

  if (voted) return null;

  return (
    <div className="card" style={{ borderColor: 'var(--plum)', borderWidth: 1.5 }}>
      <div className="sectionlabel" style={{ marginTop: 0 }}>Encuesta de Beatriz</div>
      <h3>{poll.question}</h3>
      {(poll.options || []).map(o => (
        <div key={o.id} className="optionbox"
          style={selected === o.id ? { borderColor: 'var(--plum)', background: 'var(--lav-pale)' } : {}}
          onClick={() => setSelected(o.id)}>
          {o.imageUrl && <img src={o.imageUrl} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />}
          <div className="t">{o.label}</div>
        </div>
      ))}
      <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={vote}>Votar</button>
    </div>
  );
}

/* ---------------- HORARIO ---------------- */
function HorarioTab({ bookings, schedule, holidays, events, classCancellations, punctualClasses, me, onPickClass }) {
  const settings = useContext(SettingsContext);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const dayName = dayNameForDate(selectedDate);
  const dateIso = isoDate(selectedDate);
  const holiday = isHoliday(holidays, dateIso);
  // Una clase cancelada puntualmente para este día concreto no se ofrece
  // (el horario semanal sigue igual el resto de semanas). Las clases sueltas
  // (añadidas por Beatriz solo para este día) se suman a las del horario.
  const puntualesHoy = holiday ? [] : (punctualClasses || []).filter(p => p.date === dateIso);
  const classes = holiday ? [] : [...(schedule[dayName] || []), ...puntualesHoy]
    .filter(c => !isClassCancelled(classCancellations, dateIso, c.time, c.name))
    .sort((a, b) => a.time.localeCompare(b.time));
  const isToday = sameDate(selectedDate, new Date());

  function pickDate(date) {
    setSelectedDate(date);
    setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  return (
    <>
      <MiniMonthCalendar
        monthCursor={monthCursor} setMonthCursor={setMonthCursor} selectedDate={selectedDate} holidays={holidays} events={events}
        onPickDate={pickDate}
      />
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 10px' }}>
        <button className="btn btn-outline btn-sm" onClick={() => pickDate(addDays(selectedDate, -1))}>← Anterior</button>
        <div style={{ textAlign: 'center' }}>
          <div className="serif" style={{ fontWeight: 600, fontSize: 17 }}>{fmtDate(selectedDate)}</div>
          {!isToday && <button className="linklike" onClick={() => pickDate(new Date())}>Volver a hoy</button>}
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => pickDate(addDays(selectedDate, 1))}>Siguiente →</button>
      </div>
      {holiday ? (
        <div className="muted" style={{ padding: '4px 0 8px' }}>Festivo{holiday.label ? `: ${holiday.label}` : ''} — no hay clases este día.</div>
      ) : classes.length === 0 ? (
        <div className="muted" style={{ padding: '4px 0 8px' }}>Sin clases este día.</div>
      ) : classes.map((c, idx) => {
        const cap = c.capacity || settings.defaultCapacity;
        const attendees = bookings.filter(b => b.date === dateIso && b.time === c.time && b.className === c.name && occupiesSpot(b.status)).length;
        const full = attendees >= cap;
        const isMyBooking = me && bookings.some(b => b.studentId === me.id && b.date === dateIso && b.time === c.time && b.className === c.name && occupiesSpot(b.status));
        const past = isPastSlot(dateIso, c.time);
        const tooFarAhead = !past && isTooFarAhead(dateIso);
        const pillLabel = isMyBooking ? 'Reservada' : full ? 'Completo' : past ? 'Finalizada' : tooFarAhead ? 'Próximamente' : 'Reservar';
        const pillClass = isMyBooking ? 'pill-sage' : (full || past || tooFarAhead) ? 'pill-gray' : (CLASS_STYLE[c.name] || 'pill-lav');
        return (
          <div className="classcard" key={idx} onClick={() => onPickClass(c, dateIso, dayName)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <div className="time">{c.time}</div>
              <div className="name">{c.name}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>{attendees}/{cap}</span>
              <span className={`pill ${pillClass}`}>{pillLabel}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function MiniMonthCalendar({ monthCursor, setMonthCursor, selectedDate, onPickDate, holidays, events }) {
  const month = monthCursor.getMonth();
  const gridStart = startOfWeekMonday(new Date(monthCursor.getFullYear(), month, 1));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
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
          const isSelected = sameDate(d, selectedDate);
          const isToday = sameDate(d, today);
          const holiday = isHoliday(holidays, isoDate(d));
          // Los eventos especiales (talleres) de este día también se marcan en
          // el calendario, aunque no sea festivo, para que se vea de un vistazo.
          const dayEvents = (events || []).filter(e => e.date === isoDate(d) && e.active !== false);
          const title = [holiday?.label, ...dayEvents.map(e => e.name)].filter(Boolean).join(' · ') || undefined;
          return (
            <div key={isoDate(d)} onClick={() => onPickDate(d)} title={title}
              style={{
                padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12.5,
                opacity: inMonth ? 1 : 0.32,
                background: isSelected ? 'var(--plum)' : 'transparent',
                fontWeight: isToday || isSelected ? 700 : 400,
                color: isSelected ? '#fff' : holiday ? 'var(--danger)' : isToday ? 'var(--plum)' : 'var(--ink)'
              }}>
              {d.getDate()}
              {(holiday || dayEvents.length > 0) && (
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 2 }}>
                  {holiday && <div style={{ width: 4, height: 4, borderRadius: 2, background: isSelected ? '#fff' : 'var(--danger)' }} />}
                  {dayEvents.length > 0 && <div style={{ width: 4, height: 4, borderRadius: 2, background: isSelected ? '#fff' : 'var(--plum)' }} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- BONOS ---------------- */
function BonosTab({ me, activePurchaseFor, purchases, bonos, events, bookings, onRequestBono, onRequestEvent, onRequestFreeze }) {
  const settings = useContext(SettingsContext);
  const { freezes } = useContext(FreezeContext);
  const usable = me ? activePurchaseFor(me.id) : null;
  // Un bono congelado hoy no sale como "activo", pero sigue siendo su bono.
  const frozenNow = me && !usable
    ? purchases.filter(p => p.studentId === me.id && p.status === 'confirmado' && new Date(p.expiryDate) >= new Date() && (p.classesTotal === null || p.classesUsed < p.classesTotal)
      && isFrozenOn(freezes, p.id, isoDate(new Date()))).sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0]
    : null;
  const active = usable || frozenNow;
  const activeFreezes = active ? freezesOf(freezes, active.id).filter(f => f.endDate >= isoDate(new Date()) || f.status === 'pendiente') : [];
  const hasPendingFreeze = activeFreezes.some(f => f.status === 'pendiente');
  const pendiente = me ? purchases.filter(p => p.studentId === me.id && p.status === 'pendiente').sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate))[0] : null;
  const upcomingEvents = [...(events || [])]
    .filter(e => e.active !== false && !isPastSlot(e.date, e.time))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return (
    <>
      {upcomingEvents.length > 0 && (
        <>
          <div className="sectionlabel">Eventos especiales</div>
          {upcomingEvents.map(ev => {
            const cap = ev.capacity || settings.defaultCapacity;
            const attendees = (bookings || []).filter(b => b.date === ev.date && b.time === ev.time && b.className === ev.name && occupiesSpot(b.status)).length;
            const full = attendees >= cap;
            const already = me && (bookings || []).some(b => b.studentId === me.id && b.date === ev.date && b.time === ev.time && b.className === ev.name && occupiesSpot(b.status));
            return (
              <div className="card" key={ev.id} onClick={() => onRequestEvent(ev)} style={{ cursor: 'pointer' }}>
                {ev.imageUrl && <img src={ev.imageUrl} alt="" className="postimg" style={{ marginBottom: 8 }} />}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3>{ev.name}</h3>
                    <p className="muted">{fmtDate(new Date(`${ev.date}T12:00:00`))} · {ev.time}</p>
                    {ev.description && <p className="muted">{ev.description}</p>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="serif" style={{ fontSize: 17, fontWeight: 600, color: 'var(--plum)' }}>{ev.price}€</div>
                    <span className={`pill ${already ? 'pill-sage' : full ? 'pill-gray' : 'pill-lav'}`} style={{ marginTop: 6, display: 'inline-block' }}>
                      {already ? 'Ya apuntada' : full ? 'Completo' : 'Apuntarme'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
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
              {activeFreezes.map(f => (
                <p key={f.id} className="muted" style={{ marginTop: 6 }}>
                  <span className={`pill ${f.status === 'confirmado' ? 'pill-lav' : 'pill-gray'}`}>{f.status === 'confirmado' ? 'Congelado' : 'Congelación pendiente de pago'}</span>{' '}
                  del {fmtIso(f.startDate)} al {fmtIso(f.endDate)}
                </p>
              ))}
              {hasPendingFreeze ? (
                <p className="muted" style={{ marginTop: 6 }}>Cuando Beatriz confirme tu pago, tu bono quedará congelado y se alargará esos días.</p>
              ) : (
                <button className="linklike" style={{ marginTop: 8 }} onClick={() => onRequestFreeze(active)}>
                  Congelar mi bono · {settings.freezePrice}€
                </button>
              )}
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
        const tri = bonoTrimestre(b);
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
        <p className="muted">Si no tienes bono, puedes reservar una clase individual por {settings.claseSueltaPrice}€ desde la pestaña Reservar.</p>
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 6 }}>Puedes pagar con tarjeta al momento o por Bizum al {settings.bizumPhone}. La app registra tu solicitud y, si pagas por Bizum, Beatriz la confirma en cuanto lo recibe.</p>
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
  const { freezes } = useContext(FreezeContext);
  const usable = activePurchaseFor(me.id);
  const todayIso = isoDate(new Date());
  const frozenNow = usable ? null : purchases.find(p => p.studentId === me.id && p.status === 'confirmado' && new Date(p.expiryDate) >= new Date()
    && (p.classesTotal === null || p.classesUsed < p.classesTotal) && isFrozenOn(freezes, p.id, todayIso));
  const active = usable || frozenNow;
  const freezeNow = frozenNow ? freezesOf(freezes, frozenNow.id).find(f => f.status === 'confirmado' && f.startDate <= todayIso && todayIso <= f.endDate) : null;
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
          {freezeNow && <p className="muted"><span className="pill pill-lav">Congelado</span> hasta el {fmtIso(freezeNow.endDate)}: no puedes usarlo estos días y su caducidad ya se ha alargado.</p>}
        </>
      ) : (
        <p className="muted">{bonoName(bonos, pendiente.bonoId)}{pendiente.trimestre && ' · Trimestre'} · solicitado, pendiente de confirmar el pago.</p>
      )}
    </div>
  );
}

function MyUpcomingBookings({ me, bookings, saveBookings, purchases, savePurchases, toast }) {
  const upcoming = bookings
    .filter(b => b.studentId === me.id && b.status !== 'cancelada' && new Date(b.date) >= addDays(new Date(), -1))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (upcoming.length === 0) return null;

  function cancelBooking(b) {
    const atRisk = b.paymentMethod === 'bono' && isLateCancel(b);
    const msg = atRisk
      ? `¿Cancelar tu reserva de ${b.className} el ${fmtDate(new Date(b.date))}?\n\nComo faltan menos de ${LATE_CANCEL_HOURS} horas para la clase, se descontará igualmente de tu bono.`
      : `¿Cancelar tu reserva de ${b.className} el ${fmtDate(new Date(b.date))}?`;
    if (!confirm(msg)) return;
    const late = cancelBookingAndRefund(b, bookings, saveBookings, purchases, savePurchases);
    toast(late && b.paymentMethod === 'bono' ? 'Reserva cancelada. Se ha descontado del bono por ser con poca antelación.' : 'Reserva cancelada');
  }

  return (
    <>
      <div className="sectionlabel">Mis próximas clases</div>
      {upcoming.map(b => {
        const atRisk = b.status !== 'cancelada' && b.paymentMethod === 'bono' && isLateCancel(b);
        return (
          <div className="card" key={b.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3>{b.className}</h3>
                <p className="muted">{fmtDate(new Date(b.date))} · {b.time}</p>
              </div>
              <span className={`pill ${b.status === 'confirmada' ? 'pill-sage' : b.status === 'en_espera' ? 'pill-peach' : 'pill-gray'}`}>{STATUS_LABELS[b.status] || b.status}</span>
            </div>
            {atRisk && (
              <p className="muted" style={{ marginTop: 8, color: 'var(--danger)' }}>
                Quedan menos de {LATE_CANCEL_HOURS}h: si cancelas ahora, esta clase se descuenta igualmente de tu bono.
              </p>
            )}
            <button className="linklike" style={{ color: 'var(--danger)', marginTop: 8 }} onClick={() => cancelBooking(b)}>Cancelar reserva</button>
          </div>
        );
      })}
    </>
  );
}

function PerfilTab({ me, pickProfile, clearProfile, purchases, savePurchases, bookings, saveBookings, activePurchaseFor, bonos, isAdmin, onAdminLogin, onAdminLogout, setTab, toast }) {
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
          <MyUpcomingBookings me={me} bookings={bookings} saveBookings={saveBookings} purchases={purchases} savePurchases={savePurchases} toast={toast} />
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
    const tri = trimestre ? bonoTrimestre(b) : null;
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
              .map(p => <AdminBonoEditRow key={p.id} p={p} bonos={bonos} purchases={purchases} savePurchases={savePurchases} bookings={bookings} saveBookings={saveBookings} toast={toast} />)}
          <div className="sectionlabel">Sus reservas</div>
          {bookings.filter(b => b.studentId === s.id).length === 0 ? <p className="muted">Sin reservas todavía.</p> :
            [...bookings].filter(b => b.studentId === s.id)
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map(b => <AdminReservaEditRow key={b.id} b={b} bookings={bookings} saveBookings={saveBookings} purchases={purchases} savePurchases={savePurchases} toast={toast} />)}
        </div>
      )}
      {assigningBono && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <label>Bono ya pagado (fuera de la app)</label>
          <select value={bonoId} onChange={e => setBonoId(e.target.value)}>
            <option value="">Selecciona un bono</option>
            {bonos.map(b => <option key={b.id} value={b.id}>{b.name} · {b.price}€</option>)}
          </select>
          {bonoId && bonoTrimestre(bonos.find(x => x.id === bonoId)) && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={trimestre} onChange={e => setTrimestre(e.target.checked)} />
              Trimestre ({bonoTrimestre(bonos.find(x => x.id === bonoId)).price}€, 3 meses)
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

function AdminBonoEditRow({ p, bonos, purchases, savePurchases, bookings, saveBookings, toast }) {
  const { freezes, saveFreezes } = useContext(FreezeContext);
  const [freezing, setFreezing] = useState(false);
  const [fStart, setFStart] = useState(() => isoDate(new Date()));
  const [fEnd, setFEnd] = useState(() => isoDate(addDays(new Date(), 6)));
  const [fReason, setFReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [classesUsed, setClassesUsed] = useState(p.classesUsed || 0);
  const [classesTotal, setClassesTotal] = useState(p.classesTotal === null ? '' : p.classesTotal);
  const [ilimitado, setIlimitado] = useState(p.classesTotal === null);
  const [expiryDateStr, setExpiryDateStr] = useState(() => isoDate(new Date(p.expiryDate)));

  function save() {
    const next = purchases.map(x => x.id === p.id
      ? {
        ...x,
        classesUsed: Number(classesUsed) || 0,
        classesTotal: ilimitado ? null : (Number(classesTotal) || 0),
        expiryDate: new Date(`${expiryDateStr}T12:00:00`).toISOString()
      }
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

  // Congelación gratuita decidida por Beatriz (cualquier motivo, sin coste).
  function freezeForFree() {
    if (!fStart || !fEnd || fEnd < fStart) { toast('Revisa las fechas de la congelación'); return; }
    if (freezesOf(freezes, p.id).some(f => fStart <= f.endDate && fEnd >= f.startDate)) { toast('Esas fechas se solapan con otra congelación de este bono'); return; }
    const f = {
      id: uid(), purchaseId: p.id, studentId: p.studentId, startDate: fStart, endDate: fEnd, days: freezeDays(fStart, fEnd),
      price: 0, paymentMethod: 'admin', status: 'confirmado', by: 'admin', reason: fReason.trim(), createdAt: new Date().toISOString()
    };
    const { nextPurchases, nextBookings, cancelled } = applyFreeze(f, purchases, bookings);
    const msg = `¿Congelar este bono del ${fmtIso(fStart)} al ${fmtIso(fEnd)} (${f.days} días, sin coste)? La caducidad se alargará ${f.days} días.`
      + (cancelled > 0 ? `\n\nTiene ${cancelled} clase${cancelled === 1 ? '' : 's'} reservada${cancelled === 1 ? '' : 's'} con este bono en esas fechas: se cancelará${cancelled === 1 ? '' : 'n'} y se le devolverá${cancelled === 1 ? '' : 'n'} al bono.` : '');
    if (!confirm(msg)) return;
    savePurchases(nextPurchases);
    if (cancelled > 0) saveBookings(nextBookings);
    saveFreezes([...freezes, f]);
    setFreezing(false);
    setFReason('');
    toast('Bono congelado');
  }
  function removeFreeze(f) {
    if (!confirm(`¿Quitar la congelación del ${fmtIso(f.startDate)} al ${fmtIso(f.endDate)}?${f.status === 'confirmado' ? ` La caducidad del bono se acortará ${f.days} días.` : ''}`)) return;
    saveFreezes(freezes.map(x => x.id === f.id ? { ...x, status: 'cancelado' } : x));
    if (f.status === 'confirmado') {
      savePurchases(purchases.map(x => x.id === p.id ? { ...x, expiryDate: addDays(new Date(x.expiryDate), -f.days).toISOString() } : x));
    }
    toast('Congelación quitada');
  }

  const vencido = new Date(p.expiryDate) < new Date();
  const statusPill = p.status === 'confirmado' ? (vencido ? 'pill-gray' : 'pill-sage') : p.status === 'pendiente' ? 'pill-lav' : 'pill-gray';
  const pFreezes = freezesOf(freezes, p.id);

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{bonoName(bonos, p.bonoId)}{p.trimestre && ' · Trimestre'}</h3>
        <span className={`pill ${statusPill}`}>{p.status}{p.status === 'confirmado' && vencido ? ' (caducado)' : ''}</span>
      </div>
      {editing ? (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={ilimitado} onChange={e => setIlimitado(e.target.checked)} />
            Clases ilimitadas
          </label>
          {!ilimitado && (
            <>
              <label>Clases totales (puedes regalar clases extra subiendo este número)</label>
              <input type="number" min="0" value={classesTotal} onChange={e => setClassesTotal(e.target.value)} />
            </>
          )}
          <label>Clases usadas</label>
          <input type="number" min="0" value={classesUsed} onChange={e => setClassesUsed(e.target.value)} disabled={ilimitado} />
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
          {pFreezes.map(f => (
            <p key={f.id} className="muted" style={{ marginTop: 4 }}>
              <span className={`pill ${f.status === 'confirmado' ? 'pill-lav' : 'pill-gray'}`}>{f.status === 'confirmado' ? 'Congelado' : 'Pendiente de pago'}</span>{' '}
              {fmtIso(f.startDate)} → {fmtIso(f.endDate)} · {f.by === 'admin' ? `gratis${f.reason ? ` (${f.reason})` : ''}` : `${f.price}€`}{' '}
              <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => removeFreeze(f)}>Quitar</button>
            </p>
          ))}
          {freezing ? (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
              <label>Congelar desde</label>
              <input type="date" value={fStart} onChange={e => setFStart(e.target.value)} />
              <label>Hasta (incluido)</label>
              <input type="date" value={fEnd} min={fStart} onChange={e => setFEnd(e.target.value)} />
              <label>Motivo (opcional)</label>
              <input type="text" value={fReason} onChange={e => setFReason(e.target.value)} placeholder="Ej. lesión, viaje, cierre del centro…" />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn-sage btn-sm" onClick={freezeForFree}>Congelar sin coste</button>
                <button className="linklike" onClick={() => setFreezing(false)}>Cancelar</button>
              </div>
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="linklike" onClick={() => setEditing(true)}>Editar</button>
            {p.status === 'confirmado' && !vencido && !freezing && <button className="linklike" onClick={() => setFreezing(true)}>Congelar (gratis)</button>}
            {p.status !== 'cancelado' && <button className="linklike" style={{ color: 'var(--danger)' }} onClick={cancelBono}>Cancelar bono</button>}
          </div>
        </>
      )}
    </div>
  );
}

function AdminReservaEditRow({ b, bookings, saveBookings, purchases, savePurchases, toast }) {
  const [editing, setEditing] = useState(false);
  const [dateStr, setDateStr] = useState(() => isoDate(new Date(b.date)));
  const [time, setTime] = useState(b.time);
  const [className, setClassName] = useState(b.className);

  function cancelBooking() {
    if (!confirm(`¿Cancelar esta reserva (${b.className}, ${fmtDate(new Date(b.date))})?`)) return;
    // Si cancela Beatriz, siempre se devuelve la clase al bono: la
    // penalización por poca antelación es solo cuando cancela la alumna.
    cancelBookingAndRefund(b, bookings, saveBookings, purchases, savePurchases, { forceRefund: true });
    toast(b.paymentMethod === 'bono' ? 'Reserva cancelada y clase devuelta al bono.' : 'Reserva cancelada');
  }
  function markPaid() {
    saveBookings(bookings.map(x => x.id === b.id ? { ...x, status: 'confirmada' } : x));
    toast('Reserva marcada como pagada');
  }
  function saveMove() {
    if (!dateStr || !time.trim() || !className.trim()) { toast('Rellena fecha, hora y clase'); return; }
    saveBookings(bookings.map(x => x.id === b.id
      ? { ...x, date: dateStr, time: time.trim(), className: className.trim(), day: dayNameForDate(new Date(`${dateStr}T12:00:00`)) }
      : x));
    setEditing(false);
    toast('Reserva movida');
  }

  const statusPill = b.status === 'confirmada' ? 'pill-sage' : b.status === 'pendiente_pago' ? 'pill-lav' : b.status === 'en_espera' ? 'pill-peach' : 'pill-gray';
  const otherAttendees = bookings.filter(x => x.id !== b.id && x.date === dateStr && x.time === time && x.className === className && occupiesSpot(x.status)).length;

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{b.className}</h3>
        <span className={`pill ${statusPill}`}>{STATUS_LABELS[b.status] || b.status}</span>
      </div>
      {editing ? (
        <>
          <label>Fecha</label>
          <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} />
          <label>Hora</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          <label>Clase</label>
          <input type="text" value={className} onChange={e => setClassName(e.target.value)} />
          {otherAttendees > 0 && <p className="muted" style={{ marginTop: 6 }}>Ya hay {otherAttendees} apuntada{otherAttendees === 1 ? '' : 's'} en esa clase/hora.</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sage btn-sm" onClick={saveMove}>Guardar</button>
            <button className="linklike" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{fmtDate(new Date(b.date))} · {b.time} · {b.paymentMethod === 'bono' ? 'Con bono' : (PAYMENT_LABELS[b.paymentMethod] || b.paymentMethod)}</p>
          <div className="row" style={{ marginTop: 8 }}>
            {b.status === 'pendiente_pago' && <button className="btn btn-sage btn-sm" onClick={markPaid}>Marcar pagada</button>}
            {b.status !== 'cancelada' && <button className="linklike" onClick={() => setEditing(true)}>Mover a otra fecha/hora</button>}
            {b.status !== 'cancelada' && <button className="linklike" style={{ color: 'var(--danger)' }} onClick={cancelBooking}>Cancelar</button>}
          </div>
        </>
      )}
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

function AdminTab({ adminTab, setAdminTab, students, saveStudents, bookings, purchases, wallPosts, polls, savePolls, holidays, saveHolidays, events, saveEvents, scheduledPosts, saveScheduledPosts, classCancellations, saveClassCancellations, punctualClasses, savePunctualClasses, activePurchaseFor, adminToken, schedule, saveSchedule, bonos, saveBonos, settings, saveSettings, onAdminLogout, savePurchases, saveBookings, saveWallPosts, toast }) {
  const [alumnaSearch, setAlumnaSearch] = useState('');
  const { freezes, saveFreezes } = useContext(FreezeContext);
  const tabs = [
    { id: 'estadisticas', label: 'Estadísticas' },
    { id: 'resumen', label: 'Resumen del día' },
    { id: 'alumnas', label: 'Alumnas' },
    { id: 'bonospend', label: 'Bonos pendientes' },
    { id: 'bonosactivos', label: 'Bonos confirmados' },
    { id: 'horarios', label: 'Horarios' },
    { id: 'gestionbonos', label: 'Gestionar bonos' },
    { id: 'muro', label: 'Publicar en el muro' },
    { id: 'encuestas', label: 'Encuestas' },
    { id: 'eventos', label: 'Eventos especiales' },
    { id: 'importar', label: 'Importar alumnas' },
    { id: 'ajustes', label: 'Ajustes' }
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
        <AdminResumen students={students} bookings={bookings} saveBookings={saveBookings} purchases={purchases} savePurchases={savePurchases} schedule={schedule} holidays={holidays} events={events} classCancellations={classCancellations} saveClassCancellations={saveClassCancellations} punctualClasses={punctualClasses} savePunctualClasses={savePunctualClasses} toast={toast} />
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
          <div className="sectionlabel">Congelaciones de bono por confirmar</div>
          {freezes.filter(f => f.status === 'pendiente').length === 0 ? <div className="empty">No hay congelaciones pendientes de pago.</div> :
            freezes.filter(f => f.status === 'pendiente').map(f => {
              const s = students.find(x => x.id === f.studentId);
              const p = purchases.find(x => x.id === f.purchaseId);
              return (
                <div className="card" key={f.id}>
                  <h3>Congelar {p ? bonoName(bonos, p.bonoId) : 'bono'} <span className="pill pill-lav">{f.paymentMethod === 'redsys' ? 'Tarjeta' : 'Bizum'}</span></h3>
                  <p className="muted">{s ? s.name : 'Alumna eliminada'} · {s ? s.phone : ''}</p>
                  <p className="muted">Del {fmtIso(f.startDate)} al {fmtIso(f.endDate)} ({f.days} días) · {f.price}€</p>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn btn-sage btn-sm" disabled={!p || p.status !== 'confirmado'} onClick={() => {
                      const { nextPurchases, nextBookings, cancelled } = applyFreeze(f, purchases, bookings);
                      savePurchases(nextPurchases);
                      if (cancelled > 0) saveBookings(nextBookings);
                      saveFreezes(freezes.map(x => x.id === f.id ? { ...x, status: 'confirmado' } : x));
                      toast(cancelled > 0 ? `Congelación confirmada. Se han cancelado y devuelto ${cancelled} clase${cancelled === 1 ? '' : 's'} reservada${cancelled === 1 ? '' : 's'} en esas fechas.` : 'Congelación confirmada');
                    }}>Marcar como pagada</button>
                    <button className="btn btn-outline btn-sm" onClick={() => {
                      if (!confirm(`¿Cancelar la congelación de ${s ? s.name : 'esta alumna'}?`)) return;
                      saveFreezes(freezes.map(x => x.id === f.id ? { ...x, status: 'cancelado' } : x));
                      toast('Congelación cancelada');
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
                      {freezesOf(freezes, p.id).filter(f => f.status === 'confirmado' && f.endDate >= isoDate(new Date())).map(f => (
                        <span key={f.id} className="pill pill-lav">Congelado {fmtIso(f.startDate)} → {fmtIso(f.endDate)}</span>
                      ))}
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
      {adminTab === 'horarios' && <AdminHorarios schedule={schedule} saveSchedule={saveSchedule} holidays={holidays} saveHolidays={saveHolidays} punctualClasses={punctualClasses} savePunctualClasses={savePunctualClasses} toast={toast} />}
      {adminTab === 'gestionbonos' && <AdminBonos bonos={bonos} saveBonos={saveBonos} toast={toast} />}
      {adminTab === 'muro' && <AdminMuro wallPosts={wallPosts} saveWallPosts={saveWallPosts} scheduledPosts={scheduledPosts} saveScheduledPosts={saveScheduledPosts} adminToken={adminToken} toast={toast} />}
      {adminTab === 'encuestas' && <AdminEncuestas polls={polls} savePolls={savePolls} students={students} adminToken={adminToken} toast={toast} />}
      {adminTab === 'eventos' && <AdminEventos events={events} saveEvents={saveEvents} bookings={bookings} students={students} adminToken={adminToken} toast={toast} />}
      {adminTab === 'importar' && <AdminImport students={students} saveStudents={saveStudents} toast={toast} />}
      {adminTab === 'ajustes' && <AdminAjustes settings={settings} saveSettings={saveSettings} adminToken={adminToken} onAdminLogout={onAdminLogout} toast={toast} />}
    </>
  );
}

function AdminHorarios({ schedule, saveSchedule, holidays, saveHolidays, punctualClasses, savePunctualClasses, toast }) {
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  function updateDay(day, classes) {
    saveSchedule({ ...schedule, [day]: classes });
  }
  function addPunctual({ date, time, name, capacity, duration }) {
    const entry = { id: uid(), date, time, name, capacity, duration, createdAt: new Date().toISOString() };
    savePunctualClasses([...(punctualClasses || []), entry]);
    toast(`Clase puntual "${name}" añadida para el ${fmtDate(new Date(`${date}T12:00:00`))}`);
  }
  function removePunctual(p) {
    if (!confirm(`¿Eliminar la clase puntual "${p.name}" del ${fmtDate(new Date(`${p.date}T12:00:00`))}?`)) return;
    savePunctualClasses((punctualClasses || []).filter(x => x.id !== p.id));
  }
  const upcomingPunctuales = [...(punctualClasses || [])].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return (
    <>
      <AdminFestivos holidays={holidays} saveHolidays={saveHolidays} toast={toast} />
      {upcomingPunctuales.length > 0 && (
        <div className="card">
          <h3>Clases puntuales (un solo día)</h3>
          {upcomingPunctuales.map(p => (
            <div key={p.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span>{fmtDate(new Date(`${p.date}T12:00:00`))} · {p.time} · {p.name} · aforo {p.capacity} · {slotDuration(p)} min</span>
              <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => removePunctual(p)}>Eliminar</button>
            </div>
          ))}
        </div>
      )}
      {days.map(day => (
        <AdminHorarioDay key={day} day={day} classes={schedule[day] || []} onChange={(next) => updateDay(day, next)} onAddPunctual={addPunctual} toast={toast} />
      ))}
    </>
  );
}

function AdminFestivos({ holidays, saveHolidays, toast }) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');

  function add() {
    if (!date) { toast('Elige una fecha'); return; }
    if (holidays.some(h => h.date === date)) { toast('Ese día ya está marcado como festivo'); return; }
    const holiday = { id: uid(), date, label: label.trim() };
    saveHolidays([...holidays, holiday]);
    setAdding(false);
    setDate('');
    setLabel('');
    toast('Día festivo añadido, avisando a las alumnas…');
    fetch('/api/notify-wall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Día festivo', body: `${fmtDate(new Date(`${holiday.date}T12:00:00`))}${holiday.label ? ` · ${holiday.label}` : ''}: no hay clases` })
    }).catch(() => {});
  }
  function remove(h) {
    if (!confirm(`¿Quitar el festivo del ${fmtDate(new Date(`${h.date}T12:00:00`))}?`)) return;
    saveHolidays(holidays.filter(x => x.id !== h.id));
  }

  return (
    <div className="card">
      <h3>Días festivos (sin clases)</h3>
      {holidays.length === 0 && <p className="muted">No hay ningún día festivo marcado.</p>}
      {[...holidays].sort((a, b) => a.date.localeCompare(b.date)).map(h => (
        <div key={h.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span>{fmtDate(new Date(`${h.date}T12:00:00`))}{h.label ? ` · ${h.label}` : ''}</span>
          <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => remove(h)}>Quitar</button>
        </div>
      ))}
      {adding ? (
        <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 150, flex: 'none' }} />
          <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Motivo (opcional, ej. Navidad)" style={{ width: 'auto', flex: 1 }} />
          <button className="btn btn-sage btn-sm" onClick={add}>Añadir</button>
          <button className="linklike" onClick={() => setAdding(false)}>Cancelar</button>
        </div>
      ) : (
        <button className="linklike" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>+ Marcar un día como festivo</button>
      )}
    </div>
  );
}

function AdminHorarioDay({ day, classes, onChange, onAddPunctual, toast }) {
  const settings = useContext(SettingsContext);
  const [editing, setEditing] = useState(null); // índice en edición, o 'new'
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [duration, setDuration] = useState('');
  const [scope, setScope] = useState('recurrente'); // 'recurrente' | 'puntual' (solo al añadir una clase nueva)
  const [punctualDate, setPunctualDate] = useState('');

  function startAdd() { setEditing('new'); setTime(''); setName(''); setCapacity(''); setDuration(''); setScope('recurrente'); setPunctualDate(''); }
  function startEdit(i) { setEditing(i); setTime(classes[i].time); setName(classes[i].name); setCapacity(classes[i].capacity ? String(classes[i].capacity) : ''); setDuration(classes[i].duration ? String(classes[i].duration) : ''); }
  function cancel() { setEditing(null); }
  function save() {
    if (!time.trim() || !name.trim()) return;
    const cap = capacity.trim() === '' ? settings.defaultCapacity : (Number(capacity) || settings.defaultCapacity);
    const dur = duration.trim() === '' ? 60 : (Number(duration) || 60);
    if (editing === 'new' && scope === 'puntual') {
      if (!punctualDate) { toast('Elige la fecha de la clase puntual'); return; }
      onAddPunctual({ date: punctualDate, time: time.trim(), name: name.trim(), capacity: cap, duration: dur });
      setEditing(null);
      return;
    }
    let next;
    if (editing === 'new') next = [...classes, { time: time.trim(), name: name.trim(), capacity: cap, duration: dur }];
    else next = classes.map((c, i) => i === editing ? { time: time.trim(), name: name.trim(), capacity: cap, duration: dur } : c);
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
          <input type="number" min="1" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder={`Aforo (${settings.defaultCapacity})`} style={{ width: 90, flex: 'none' }} />
          <input type="number" min="5" step="5" value={duration} onChange={e => setDuration(e.target.value)} placeholder="Min. (60)" style={{ width: 90, flex: 'none' }} />
          <button className="btn btn-sage btn-sm" onClick={save}>Guardar</button>
          <button className="linklike" onClick={cancel}>Cancelar</button>
        </div>
      ) : (
        <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span>{c.time} · {c.name} · aforo {c.capacity || settings.defaultCapacity} · {slotDuration(c)} min</span>
          <div className="row">
            <button className="linklike" onClick={() => startEdit(i)}>Editar</button>
            <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => remove(i)}>Eliminar</button>
          </div>
        </div>
      ))}
      {editing === 'new' ? (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className={`chip ${scope === 'recurrente' ? 'active' : ''}`} onClick={() => setScope('recurrente')}>Todas las semanas</div>
            <div className={`chip ${scope === 'puntual' ? 'active' : ''}`} onClick={() => setScope('puntual')}>Solo un día concreto</div>
          </div>
          {scope === 'puntual' && (
            <input type="date" value={punctualDate} onChange={e => setPunctualDate(e.target.value)} style={{ width: 150, marginBottom: 8 }} />
          )}
          <div className="row" style={{ alignItems: 'center' }}>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ width: 110, flex: 'none' }} />
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la clase" style={{ width: 'auto', flex: 1 }} />
            <input type="number" min="1" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder={`Aforo (${settings.defaultCapacity})`} style={{ width: 90, flex: 'none' }} />
            <input type="number" min="5" step="5" value={duration} onChange={e => setDuration(e.target.value)} placeholder="Min. (60)" style={{ width: 90, flex: 'none' }} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sage btn-sm" onClick={save}>{scope === 'puntual' ? 'Añadir clase puntual' : 'Añadir'}</button>
            <button className="linklike" onClick={cancel}>Cancelar</button>
          </div>
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
      <label>Precio del trimestre, 3 meses (vacío = sin opción de trimestre)</label>
      <input type="number" value={form.trimestrePrice} onChange={e => setForm({ ...form, trimestrePrice: e.target.value })} placeholder="Ej. 350" />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-sage btn-sm" onClick={onSave}>Guardar</button>
        <button className="linklike" onClick={onCancel}>Cancelar</button>
      </div>
    </>
  );
}

function AdminBonos({ bonos, saveBonos, toast }) {
  const [editing, setEditing] = useState(null); // id en edición, o 'new'
  const [form, setForm] = useState({ name: '', desc: '', price: '', classes: '', trimestrePrice: '' });

  function startAdd() { setEditing('new'); setForm({ name: '', desc: '', price: '', classes: '', trimestrePrice: '' }); }
  function startEdit(b) { setEditing(b.id); setForm({ name: b.name, desc: b.desc, price: String(b.price), classes: b.classes === null ? '' : String(b.classes), trimestrePrice: b.trimestrePrice ? String(b.trimestrePrice) : '' }); }
  function cancel() { setEditing(null); }
  function save() {
    if (!form.name.trim() || !form.price) { toast('Nombre y precio son obligatorios'); return; }
    const classesVal = form.classes.trim() === '' ? null : Number(form.classes);
    const trimestrePriceVal = form.trimestrePrice.trim() === '' ? undefined : Number(form.trimestrePrice);
    const bonoData = { name: form.name.trim(), desc: form.desc.trim(), price: Number(form.price), classes: classesVal, trimestrePrice: trimestrePriceVal };
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
                  {b.trimestrePrice ? <p className="muted">Trimestre: {b.trimestrePrice}€</p> : null}
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

function AdminResumen({ students, bookings, saveBookings, purchases, savePurchases, schedule, holidays, events, classCancellations, saveClassCancellations, punctualClasses, savePunctualClasses, toast }) {
  const settings = useContext(SettingsContext);
  const [offset, setOffset] = useState(0);
  const [creatingExtra, setCreatingExtra] = useState(false);
  const [extraTime, setExtraTime] = useState('');
  const [extraName, setExtraName] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);

  const date = addDays(new Date(), offset);
  const dateIso = isoDate(date);
  const dayName = Object.keys(DAY_INDEX).find(k => DAY_INDEX[k] === date.getDay());
  const holiday = isHoliday(holidays, dateIso);
  const classes = holiday ? [] : (schedule[dayName] || []);

  const scheduledKeys = new Set(classes.map(c => `${c.time}|${c.name}`));
  const extraFromBookings = [];
  const seenExtra = new Set();
  // Los eventos especiales de este día aparecen aquí aunque nadie se haya
  // apuntado todavía, y con su propio aforo (no el de las clases normales).
  (events || []).filter(e => e.date === dateIso).forEach(e => {
    const k = `${e.time}|${e.name}`;
    if (!scheduledKeys.has(k) && !seenExtra.has(k)) { seenExtra.add(k); extraFromBookings.push({ time: e.time, name: e.name, capacity: e.capacity }); }
  });
  bookings.filter(b => b.date === dateIso && b.status !== 'cancelada').forEach(b => {
    const k = `${b.time}|${b.className}`;
    if (!scheduledKeys.has(k) && !seenExtra.has(k)) { seenExtra.add(k); extraFromBookings.push({ time: b.time, name: b.className }); }
  });
  // Clases sueltas que Beatriz ha añadido para este día concreto (desde aquí
  // o desde Horarios), persistidas de verdad: no desaparecen al recargar.
  (punctualClasses || []).filter(p => p.date === dateIso).forEach(p => {
    const k = `${p.time}|${p.name}`;
    if (!scheduledKeys.has(k) && !seenExtra.has(k)) { seenExtra.add(k); extraFromBookings.push(p); }
  });
  const allClasses = [...classes, ...extraFromBookings].sort((a, b) => a.time.localeCompare(b.time));

  function createExtra() {
    if (!extraTime.trim() || !extraName.trim()) { toast('Pon hora y nombre de la clase'); return; }
    const c = { id: uid(), date: dateIso, time: extraTime.trim(), name: extraName.trim(), capacity: settings.defaultCapacity, duration: 60, createdAt: new Date().toISOString() };
    savePunctualClasses([...(punctualClasses || []), c]);
    setCreatingExtra(false);
    setExtraTime('');
    setExtraName('');
    setSelectedKey(`${c.time}|${c.name}`);
  }

  const PX_PER_MIN = 1;
  const MIN_BLOCK_H = 40;
  let rangeStart = 8 * 60, rangeEnd = 20 * 60;
  if (allClasses.length) {
    const starts = allClasses.map(c => toMinutes(c.time));
    const ends = allClasses.map(c => toMinutes(c.time) + slotDuration(c));
    rangeStart = Math.max(0, Math.floor(Math.min(...starts) / 60) * 60 - 60);
    rangeEnd = Math.min(24 * 60, Math.ceil(Math.max(...ends) / 60) * 60 + 60);
  }
  const hours = [];
  for (let m = rangeStart; m <= rangeEnd; m += 60) hours.push(m);
  const totalHeight = (rangeEnd - rangeStart) * PX_PER_MIN;
  const selectedCls = allClasses.find(c => `${c.time}|${c.name}` === selectedKey) || null;

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
      {holiday && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <b>Festivo{holiday.label ? `: ${holiday.label}` : ''}</b>
          <p className="muted" style={{ marginTop: 4 }}>No se muestran las clases programadas de este día.</p>
        </div>
      )}
      {allClasses.length === 0 ? (
        <div className="empty">No hay clases programadas este día.</div>
      ) : (
        <>
        <p className="muted" style={{ textAlign: 'center', margin: '0 0 8px' }}>Toca una clase para ver el detalle y añadir alumnas.</p>
        <div className="timeline-wrap">
          <div className="timeline-scroll">
            <div style={{ position: 'relative', height: totalHeight }}>
              {hours.map(m => (
                <div key={m} className="timeline-hourline" style={{ top: (m - rangeStart) * PX_PER_MIN }}>
                  <span className="timeline-hourlabel">{String(Math.floor(m / 60)).padStart(2, '0')}:00</span>
                </div>
              ))}
              {allClasses.map((c, idx) => {
                const key = `${c.time}|${c.name}`;
                const cancelled = isClassCancelled(classCancellations, dateIso, c.time, c.name);
                const attendees = bookings.filter(b => b.date === dateIso && b.time === c.time && b.className === c.name && occupiesSpot(b.status)).length;
                const waiting = bookings.filter(b => b.date === dateIso && b.time === c.time && b.className === c.name && b.status === 'en_espera').length;
                const cap = c.capacity || settings.defaultCapacity;
                const full = attendees >= cap;
                const top = (toMinutes(c.time) - rangeStart) * PX_PER_MIN;
                const height = Math.max(slotDuration(c) * PX_PER_MIN, MIN_BLOCK_H);
                const styleClass = cancelled ? 'pill-gray' : (CLASS_STYLE[c.name] || 'pill-gray');
                return (
                  <div key={idx}
                    className={`timeline-block ${styleClass} ${key === selectedKey ? 'selected' : ''} ${full ? 'full' : ''}`}
                    style={{ top, height, opacity: cancelled ? 0.6 : 1 }}
                    onClick={() => setSelectedKey(key === selectedKey ? null : key)}>
                    <div className="tb-time">{c.time}</div>
                    <div className="tb-name" style={cancelled ? { textDecoration: 'line-through' } : undefined}>{c.name}</div>
                    <div className="tb-meta">{cancelled ? 'Cancelada este día' : `${attendees}/${cap}${waiting > 0 ? ` · +${waiting} en espera` : ''}`}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </>
      )}
      {selectedCls && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSelectedKey(null)}>
          <div className="modal-sheet">
            <button className="modal-close" onClick={() => setSelectedKey(null)}>×</button>
            <AdminResumenClass cls={selectedCls} dateIso={dateIso} students={students} bookings={bookings}
              saveBookings={saveBookings} purchases={purchases} savePurchases={savePurchases}
              classCancellations={classCancellations} saveClassCancellations={saveClassCancellations}
              punctualClasses={punctualClasses} savePunctualClasses={savePunctualClasses} toast={toast} />
          </div>
        </div>
      )}
      <div className="card">
        {creatingExtra ? (
          <>
            <label>Clase puntual (solo para este día)</label>
            <div className="row" style={{ alignItems: 'center' }}>
              <input type="time" value={extraTime} onChange={e => setExtraTime(e.target.value)} style={{ width: 110, flex: 'none' }} />
              <input type="text" value={extraName} onChange={e => setExtraName(e.target.value)} placeholder="Nombre de la clase/evento" style={{ width: 'auto', flex: 1 }} />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-sage btn-sm" onClick={createExtra}>Crear</button>
              <button className="linklike" onClick={() => setCreatingExtra(false)}>Cancelar</button>
            </div>
          </>
        ) : (
          <button className="linklike" onClick={() => setCreatingExtra(true)}>+ Añadir clase puntual (solo este día)</button>
        )}
      </div>
    </>
  );
}

function AdminResumenClass({ cls: c, dateIso, students, bookings, saveBookings, purchases, savePurchases, classCancellations, saveClassCancellations, punctualClasses, savePunctualClasses, toast }) {
  const settings = useContext(SettingsContext);
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState('puntual'); // 'puntual' | 'fija'
  const [search, setSearch] = useState('');
  const [payMethod, setPayMethod] = useState('efectivo');

  const allForClass = bookings.filter(b => b.date === dateIso && b.time === c.time && b.className === c.name);
  const attendees = allForClass.filter(b => occupiesSpot(b.status));
  const waiting = allForClass.filter(b => b.status === 'en_espera');
  const cap = c.capacity || settings.defaultCapacity;
  const full = attendees.length >= cap;

  const q = search.trim().toLowerCase();
  const alreadyIn = new Set([...attendees, ...waiting].map(b => b.studentId));
  const matches = [...students]
    .filter(s => !alreadyIn.has(s.id))
    .filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.phone || '').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  function buildBooking(s, dateStr) {
    return {
      id: uid(), studentId: s.id, day: dayNameForDate(new Date(`${dateStr}T12:00:00`)), time: c.time, className: c.name,
      date: dateStr, status: 'confirmada', paymentMethod: payMethod, price: settings.claseSueltaPrice,
      createdAt: new Date().toISOString()
    };
  }

  function addStudent(s) {
    if (addMode === 'fija') {
      const recurrenceId = uid();
      const newBookings = [];
      let skipped = 0;
      for (let w = 0; w < RECURRING_WEEKS; w++) {
        const dStr = isoDate(addDays(new Date(`${dateIso}T12:00:00`), w * 7));
        const occupiedThatDay = bookings.filter(b => b.date === dStr && b.time === c.time && b.className === c.name && occupiesSpot(b.status)).length
          + newBookings.filter(b => b.date === dStr).length;
        if (occupiedThatDay >= cap) { skipped++; continue; }
        newBookings.push({ ...buildBooking(s, dStr), recurrenceId });
      }
      if (newBookings.length === 0) { toast('No se pudo crear ninguna clase: aforo completo en todas las semanas'); return; }
      saveBookings([...bookings, ...newBookings]);
      setAdding(false);
      setSearch('');
      toast(`${s.name} añadida como fija: ${newBookings.length} clase${newBookings.length === 1 ? '' : 's'} creada${newBookings.length === 1 ? '' : 's'}${skipped ? `, ${skipped} semana${skipped === 1 ? '' : 's'} saltada${skipped === 1 ? '' : 's'} por aforo` : ''}`);
    } else {
      saveBookings([...bookings, buildBooking(s, dateIso)]);
      setAdding(false);
      setSearch('');
      toast(`${s.name} añadida a ${c.name} (${payMethod})`);
    }
  }

  function addToWaitlist(s) {
    const booking = {
      id: uid(), studentId: s.id, day: dayNameForDate(new Date(`${dateIso}T12:00:00`)), time: c.time, className: c.name,
      date: dateIso, status: 'en_espera', createdAt: new Date().toISOString()
    };
    saveBookings([...bookings, booking]);
    setAdding(false);
    setSearch('');
    toast(`${s.name} añadida a la lista de espera`);
  }

  function cancelOne(b) {
    // Cancela Beatriz: siempre se devuelve la clase al bono si se pagó con uno.
    cancelBookingAndRefund(b, bookings, saveBookings, purchases, savePurchases, { forceRefund: true });
    toast(b.paymentMethod === 'bono' ? 'Reserva cancelada y clase devuelta al bono.' : 'Reserva cancelada');
  }

  function cancelSeries(b) {
    if (!confirm('¿Cancelar esta clase y todas las siguientes de esta serie fija?')) return;
    const toCancel = bookings.filter(x => x.recurrenceId === b.recurrenceId && x.date >= b.date && x.status !== 'cancelada');
    saveBookings(bookings.map(x => toCancel.some(y => y.id === x.id) ? { ...x, status: 'cancelada' } : x));
    if (purchases && savePurchases) {
      const bonoBookings = toCancel.filter(x => x.paymentMethod === 'bono');
      if (bonoBookings.length > 0) {
        let nextPurchases = purchases;
        bonoBookings.forEach(x => {
          const purchase = findBonoPurchaseForBooking(x, nextPurchases);
          if (purchase) {
            nextPurchases = nextPurchases.map(p => p.id === purchase.id ? { ...p, classesUsed: Math.max(0, (p.classesUsed || 0) - 1) } : p);
          }
        });
        savePurchases(nextPurchases);
      }
    }
    toast('Serie cancelada desde esta fecha');
  }

  function confirmWaiting(b) {
    if (attendees.length >= cap) { toast('La clase sigue completa'); return; }
    saveBookings(bookings.map(x => x.id === b.id ? { ...x, status: 'confirmada', paymentMethod: x.paymentMethod || 'efectivo', price: x.price || settings.claseSueltaPrice } : x));
    toast('Movida de lista de espera a confirmada');
  }

  // Cancela ESTA clase concreta solo para este día (el horario semanal no
  // cambia; el resto de semanas de este día de la semana siguen igual).
  function cancelOccurrence() {
    const toCancel = allForClass.filter(x => x.status !== 'cancelada');
    const msg = toCancel.length > 0
      ? `¿Cancelar ${c.name} de ${fmtDate(new Date(`${dateIso}T12:00:00`))} (${c.time})?\n\nHay ${toCancel.length} alumna${toCancel.length === 1 ? '' : 's'} apuntada${toCancel.length === 1 ? '' : 's'}: se le${toCancel.length === 1 ? '' : 's'} cancelará la reserva (y se le${toCancel.length === 1 ? '' : 's'} devolverá la clase si la pagó con bono). Avísala${toCancel.length === 1 ? '' : 's'} tú directamente.\n\nEl resto de semanas de este día no se ven afectadas.`
      : `¿Cancelar ${c.name} de ${fmtDate(new Date(`${dateIso}T12:00:00`))} (${c.time}) solo para este día? El resto de semanas no se ven afectadas.`;
    if (!confirm(msg)) return;
    if (toCancel.length > 0) {
      saveBookings(bookings.map(x => toCancel.some(y => y.id === x.id) ? { ...x, status: 'cancelada' } : x));
      if (purchases && savePurchases) {
        const bonoBookings = toCancel.filter(x => x.paymentMethod === 'bono');
        if (bonoBookings.length > 0) {
          let nextPurchases = purchases;
          bonoBookings.forEach(x => {
            const purchase = findBonoPurchaseForBooking(x, nextPurchases);
            if (purchase) nextPurchases = nextPurchases.map(p => p.id === purchase.id ? { ...p, classesUsed: Math.max(0, (p.classesUsed || 0) - 1) } : p);
          });
          savePurchases(nextPurchases);
        }
      }
    }
    saveClassCancellations([...(classCancellations || []), { id: uid(), date: dateIso, time: c.time, className: c.name, createdAt: new Date().toISOString() }]);
    toast('Clase cancelada solo para este día. El resto de semanas sigue igual.');
  }

  function reactivateOccurrence() {
    saveClassCancellations((classCancellations || []).filter(x => !(x.date === dateIso && x.time === c.time && x.className === c.name)));
    toast('Clase reactivada para este día');
  }

  // Las clases puntuales (añadidas para un único día, sin horario semanal
  // detrás) no se "cancelan": al no tener recurrencia, eliminarlas directamente
  // ya las quita del todo, no hace falta guardar una cancelación aparte.
  function deletePunctual() {
    const toCancel = allForClass.filter(x => x.status !== 'cancelada');
    const msg = toCancel.length > 0
      ? `¿Eliminar la clase puntual ${c.name} de ${fmtDate(new Date(`${dateIso}T12:00:00`))} (${c.time})?\n\nHay ${toCancel.length} alumna${toCancel.length === 1 ? '' : 's'} apuntada${toCancel.length === 1 ? '' : 's'}: se le${toCancel.length === 1 ? '' : 's'} cancelará la reserva (y se le${toCancel.length === 1 ? '' : 's'} devolverá la clase si la pagó con bono). Avísala${toCancel.length === 1 ? '' : 's'} tú directamente.`
      : `¿Eliminar la clase puntual ${c.name} de ${fmtDate(new Date(`${dateIso}T12:00:00`))} (${c.time})?`;
    if (!confirm(msg)) return;
    if (toCancel.length > 0) {
      saveBookings(bookings.map(x => toCancel.some(y => y.id === x.id) ? { ...x, status: 'cancelada' } : x));
      if (purchases && savePurchases) {
        const bonoBookings = toCancel.filter(x => x.paymentMethod === 'bono');
        if (bonoBookings.length > 0) {
          let nextPurchases = purchases;
          bonoBookings.forEach(x => {
            const purchase = findBonoPurchaseForBooking(x, nextPurchases);
            if (purchase) nextPurchases = nextPurchases.map(p => p.id === purchase.id ? { ...p, classesUsed: Math.max(0, (p.classesUsed || 0) - 1) } : p);
          });
          savePurchases(nextPurchases);
        }
      }
    }
    savePunctualClasses((punctualClasses || []).filter(x => x.id !== c.id));
    toast('Clase puntual eliminada');
  }

  const cancelled = isClassCancelled(classCancellations, dateIso, c.time, c.name);
  if (cancelled) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <div className="time">{c.time}</div>
            <div className="name" style={{ textDecoration: 'line-through' }}>{c.name}</div>
          </div>
          <span className="pill pill-gray">Cancelada</span>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>Esta clase está cancelada solo para este día. El resto de semanas de este día sigue con normalidad.</p>
        <button className="btn btn-sage btn-sm" style={{ marginTop: 8 }} onClick={reactivateOccurrence}>Reactivar esta clase</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div className="time">{c.time}</div>
          <div className="name">{c.name}</div>
        </div>
        <span className="pill pill-lav">{attendees.length}/{cap}</span>
      </div>
      {attendees.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          {attendees.map(b => {
            const s = students.find(x => x.id === b.studentId);
            return (
              <li key={b.id} className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', listStyle: 'none', marginLeft: -18, marginBottom: 4 }}>
                <span>{s ? s.name : 'Alumna eliminada'}</span>
                {b.status === 'pendiente_pago' && <span className="pill pill-gray">Pago pendiente</span>}
                {b.paymentMethod === 'efectivo' && <span className="pill pill-sage">Efectivo</span>}
                {b.paymentMethod === 'transferencia' && <span className="pill pill-sage">Transferencia</span>}
                {b.recurrenceId && <span className="pill pill-lav">Fija</span>}
                <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => cancelOne(b)}>Cancelar</button>
                {b.recurrenceId && <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => cancelSeries(b)}>Cancelar serie</button>}
              </li>
            );
          })}
        </ul>
      )}
      {waiting.length > 0 && (
        <>
          <div className="muted" style={{ marginTop: 12, fontWeight: 600 }}>Lista de espera ({waiting.length})</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {waiting.map(b => {
              const s = students.find(x => x.id === b.studentId);
              return (
                <li key={b.id} className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', listStyle: 'none', marginLeft: -18, marginBottom: 4 }}>
                  <span>{s ? s.name : 'Alumna eliminada'}</span>
                  <button className="linklike" onClick={() => confirmWaiting(b)}>Confirmar</button>
                  <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => cancelOne(b)}>Quitar</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {adding ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          {!full && (
            <div className="row" style={{ marginBottom: 8 }}>
              <button type="button" className={`chip ${addMode === 'puntual' ? 'active' : ''}`} onClick={() => setAddMode('puntual')}>Puntual</button>
              <button type="button" className={`chip ${addMode === 'fija' ? 'active' : ''}`} onClick={() => setAddMode('fija')}>Fija (cada semana)</button>
            </div>
          )}
          {!full && (
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ marginBottom: 8 }}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
            </select>
          )}
          {full && <p className="muted" style={{ marginBottom: 8 }}>Clase completa: se añadirá a la lista de espera.</p>}
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o teléfono (o desplázate para ver todas)…" autoFocus />
          {matches.length === 0 && <p className="muted" style={{ marginTop: 6 }}>Sin resultados.</p>}
          <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 4 }}>
            {matches.map(s => (
              <div key={s.id} className="optionbox" style={{ marginTop: 8 }} onClick={() => full ? addToWaitlist(s) : addStudent(s)}>
                <div className="t">{s.name}</div>
                <div className="s">{s.phone}</div>
              </div>
            ))}
          </div>
          <button className="linklike" style={{ marginTop: 8 }} onClick={() => { setAdding(false); setSearch(''); }}>Cancelar</button>
        </div>
      ) : (
        <button className="linklike" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
          {full ? '+ Añadir a lista de espera' : '+ Añadir alumna'}
        </button>
      )}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
        {c.id ? (
          <button className="linklike" style={{ color: 'var(--danger)' }} onClick={deletePunctual}>Eliminar esta clase puntual</button>
        ) : (
          <button className="linklike" style={{ color: 'var(--danger)' }} onClick={cancelOccurrence}>Cancelar esta clase (solo este día)</button>
        )}
      </div>
    </div>
  );
}

function AdminMuro({ wallPosts, saveWallPosts, scheduledPosts, saveScheduledPosts, adminToken, toast }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [publishAt, setPublishAt] = useState(''); // vacío = publicar ya; si no, valor de datetime-local

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

  function resetForm() {
    setTitle(''); setContent(''); setImageUrl(null); setImagePreview(null); setPublishAt('');
  }

  function publish() {
    if (!title.trim() || !content.trim()) { toast('Escribe un título y un mensaje'); return; }
    if (publishAt) {
      const publishDate = new Date(publishAt);
      if (isNaN(publishDate.getTime()) || publishDate <= new Date()) { toast('Elige una fecha y hora futuras, o déjalo en blanco para publicar ya'); return; }
      const scheduled = { id: uid(), title: title.trim(), content: content.trim(), imageUrl: imageUrl || null, publishAt: publishDate.toISOString(), createdAt: new Date().toISOString() };
      saveScheduledPosts([...scheduledPosts, scheduled]);
      resetForm();
      toast(`Publicación programada para el ${fmtDate(publishDate)} a las ${publishDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`);
    } else {
      saveWallPosts([...wallPosts, { id: uid(), title: title.trim(), content: content.trim(), imageUrl: imageUrl || null, date: new Date().toISOString() }]);
      resetForm();
      toast('Publicado en el muro, avisando a las alumnas…');
      fetch('/api/notify-wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: content.trim() })
      }).catch(() => {});
    }
  }

  function cancelScheduled(p) {
    if (!confirm('¿Cancelar esta publicación programada?')) return;
    if (p.imageUrl) deleteWallImage(p.imageUrl, adminToken);
    saveScheduledPosts(scheduledPosts.filter(x => x.id !== p.id));
    toast('Publicación programada cancelada');
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
        <label>Programar publicación (opcional)</label>
        <input type="datetime-local" value={publishAt} onChange={e => setPublishAt(e.target.value)} />
        <p className="muted" style={{ marginTop: 4 }}>{publishAt ? 'Se publicará sola en esa fecha y hora, avisando a las alumnas.' : 'Déjalo en blanco para publicarlo ahora mismo.'}</p>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={uploading} onClick={publish}>
          {publishAt ? 'Programar publicación' : 'Publicar en el muro'}
        </button>
      </div>
      {scheduledPosts.length > 0 && (
        <>
          <div className="sectionlabel">Programadas</div>
          {[...scheduledPosts].sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt)).map(p => (
            <div className="card postcard" key={p.id} style={{ borderLeftColor: 'var(--peach)' }}>
              <div className="postdate">Se publica el {fmtDate(new Date(p.publishAt))} a las {new Date(p.publishAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
              <h3>{p.title}</h3>
              {p.imageUrl && <img src={p.imageUrl} alt="" className="postimg" />}
              <p>{p.content}</p>
              <button className="linklike" style={{ color: 'var(--danger)', marginTop: 8 }} onClick={() => cancelScheduled(p)}>Cancelar programación</button>
            </div>
          ))}
        </>
      )}
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

function AdminEncuestas({ polls, savePolls, students, adminToken, toast }) {
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState([{ label: '', imageUrl: null }, { label: '', imageUrl: null }]);

  function updateOptionLabel(i, value) {
    setOptions(prev => prev.map((o, x) => x === i ? { ...o, label: value } : o));
  }
  function addOption() {
    setOptions(prev => prev.length >= 5 ? prev : [...prev, { label: '', imageUrl: null }]);
  }
  function removeOption(i) {
    const opt = options[i];
    if (opt?.imageUrl) deleteWallImage(opt.imageUrl, adminToken);
    setOptions(prev => prev.length <= 2 ? prev : prev.filter((_, x) => x !== i));
  }
  async function handleOptionImage(i, file) {
    if (!file) return;
    setOptions(prev => prev.map((o, x) => x === i ? { ...o, uploading: true } : o));
    try {
      const url = await uploadWallImage(file);
      setOptions(prev => prev.map((o, x) => x === i ? { ...o, imageUrl: url, uploading: false } : o));
    } catch (err) {
      toast(err.message || 'No se pudo subir la imagen');
      setOptions(prev => prev.map((o, x) => x === i ? { ...o, uploading: false } : o));
    }
  }
  function removeOptionImage(i) {
    const opt = options[i];
    if (opt?.imageUrl) deleteWallImage(opt.imageUrl, adminToken);
    setOptions(prev => prev.map((o, x) => x === i ? { ...o, imageUrl: null } : o));
  }
  function resetForm() {
    setCreating(false);
    setQuestion('');
    setOptions([{ label: '', imageUrl: null }, { label: '', imageUrl: null }]);
  }
  function publish() {
    const cleanOptions = options.map(o => ({ label: o.label.trim(), imageUrl: o.imageUrl || null })).filter(o => o.label);
    if (!question.trim() || cleanOptions.length < 2) { toast('Escribe la pregunta y al menos 2 opciones'); return; }
    const poll = {
      id: uid(), question: question.trim(),
      options: cleanOptions.map(o => ({ id: uid(), label: o.label, imageUrl: o.imageUrl })),
      votes: [], active: true, createdAt: new Date().toISOString()
    };
    savePolls([...polls, poll]);
    resetForm();
    toast('Encuesta publicada, avisando a las alumnas…');
    fetch('/api/notify-wall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nueva encuesta', body: poll.question })
    }).catch(() => {});
  }
  function toggleActive(p) {
    savePolls(polls.map(x => x.id === p.id ? { ...x, active: x.active === false } : x));
  }
  function removePoll(p) {
    if (!confirm('¿Eliminar esta encuesta y sus votos?')) return;
    (p.options || []).forEach(o => { if (o.imageUrl) deleteWallImage(o.imageUrl, adminToken); });
    savePolls(polls.filter(x => x.id !== p.id));
    toast('Encuesta eliminada');
  }

  return (
    <>
      <div className="card">
        {creating ? (
          <>
            <label>Pregunta</label>
            <input type="text" value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ej. ¿Qué horario preferís para Balance Yoga?" />
            <label>Opciones (con foto opcional, ej. para elegir equipación)</label>
            {options.map((o, i) => (
              <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div className="row" style={{ alignItems: 'center' }}>
                  <input type="text" value={o.label} onChange={e => updateOptionLabel(i, e.target.value)} placeholder={`Opción ${i + 1}`} style={{ width: 'auto', flex: 1 }} />
                  {options.length > 2 && <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => removeOption(i)}>Quitar</button>}
                </div>
                {o.imageUrl ? (
                  <div style={{ position: 'relative', marginTop: 8 }}>
                    <img src={o.imageUrl} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, opacity: o.uploading ? 0.5 : 1 }} />
                    <button className="linklike" style={{ color: 'var(--danger)', marginTop: 6 }} onClick={() => removeOptionImage(i)}>Quitar foto</button>
                  </div>
                ) : o.uploading ? (
                  <p className="muted" style={{ marginTop: 6 }}>Subiendo imagen…</p>
                ) : (
                  <input type="file" accept="image/*" style={{ marginTop: 8 }} onChange={e => handleOptionImage(i, e.target.files[0])} />
                )}
              </div>
            ))}
            {options.length < 5 && <button className="linklike" onClick={addOption}>+ Añadir opción</button>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={publish}>Publicar encuesta</button>
              <button className="linklike" onClick={resetForm}>Cancelar</button>
            </div>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nueva encuesta</button>
        )}
      </div>
      <div className="sectionlabel">Encuestas</div>
      {polls.length === 0 ? <div className="empty">Todavía no has creado ninguna encuesta.</div> :
        [...polls].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(p => {
          const votes = p.votes || [];
          const total = votes.length;
          const closed = p.active === false;
          return (
            <div className="card" key={p.id}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3 style={{ margin: 0 }}>{p.question}</h3>
                <span className={`pill ${closed ? 'pill-gray' : 'pill-sage'}`}>{closed ? 'Cerrada' : 'Activa'}</span>
              </div>
              <p className="muted" style={{ marginTop: 4 }}>{total} voto{total === 1 ? '' : 's'} de {students.length} alumnas</p>
              {(p.options || []).map(o => {
                const optVotes = votes.filter(v => v.optionId === o.id);
                const count = optVotes.length;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                const voterNames = optVotes.map(v => students.find(s => s.id === v.studentId)?.name || 'Alumna eliminada');
                return (
                  <div key={o.id} style={{ marginTop: 10 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                        {o.imageUrl && <img src={o.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6 }} />}
                        <span style={{ fontSize: 13.5 }}>{o.label}</span>
                      </div>
                      <span className="muted">{count} · {pct}%</span>
                    </div>
                    <div style={{ background: 'var(--cream-2)', borderRadius: 6, height: 8, marginTop: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, background: 'var(--plum)', height: '100%', borderRadius: 6 }} />
                    </div>
                    {voterNames.length > 0 && <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>{voterNames.join(', ')}</p>}
                  </div>
                );
              })}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="linklike" onClick={() => toggleActive(p)}>{closed ? 'Reabrir' : 'Cerrar encuesta'}</button>
                <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => removePoll(p)}>Eliminar</button>
              </div>
            </div>
          );
        })}
    </>
  );
}

function AdminEventos({ events, saveEvents, bookings, students, adminToken, toast }) {
  const settings = useContext(SettingsContext);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [price, setPrice] = useState('');
  const [capacity, setCapacity] = useState('');
  const [imageUrl, setImageUrl] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);

  function resetForm() {
    setCreating(false);
    setName(''); setDescription(''); setDate(''); setTime(''); setPrice(''); setCapacity('');
    setImageUrl(null); setImagePreview(null);
  }

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

  function publish() {
    if (!name.trim() || !date || !time || !price) { toast('Rellena al menos nombre, fecha, hora y precio'); return; }
    const event = {
      id: uid(), name: name.trim(), description: description.trim(),
      date, time, price: Number(price), capacity: capacity.trim() === '' ? settings.defaultCapacity : Number(capacity),
      imageUrl: imageUrl || null, active: true, createdAt: new Date().toISOString()
    };
    saveEvents([...events, event]);
    resetForm();
    toast('Evento publicado, avisando a las alumnas…');
    fetch('/api/notify-wall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nuevo evento especial', body: `${event.name} · ${fmtDate(new Date(`${event.date}T12:00:00`))}` })
    }).catch(() => {});
  }
  function toggleActive(ev) {
    saveEvents(events.map(x => x.id === ev.id ? { ...x, active: x.active === false } : x));
  }
  function removeEvent(ev) {
    if (!confirm(`¿Eliminar el evento "${ev.name}"? Las reservas que ya tenga no se ven afectadas.`)) return;
    if (ev.imageUrl) deleteWallImage(ev.imageUrl, adminToken);
    saveEvents(events.filter(x => x.id !== ev.id));
    toast('Evento eliminado');
  }

  return (
    <>
      <div className="card">
        {creating ? (
          <>
            <label>Nombre del evento</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Taller de luna llena" />
            <label>Descripción (opcional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Cuenta en qué consiste el evento" />
            <div className="row">
              <div style={{ flex: 1 }}>
                <label>Fecha</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Hora</label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label>Precio (€)</label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="35" />
              </div>
              <div style={{ flex: 1 }}>
                <label>Aforo</label>
                <input type="number" min="1" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder={`${settings.defaultCapacity}`} />
              </div>
            </div>
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
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" disabled={uploading} onClick={publish}>Publicar evento</button>
              <button className="linklike" onClick={resetForm}>Cancelar</button>
            </div>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nuevo evento especial</button>
        )}
      </div>
      <div className="sectionlabel">Eventos</div>
      {events.length === 0 ? <div className="empty">Todavía no has creado ningún evento.</div> :
        [...events].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).map(ev => {
          const attendees = bookings.filter(b => b.date === ev.date && b.time === ev.time && b.className === ev.name && occupiesSpot(b.status));
          const closed = ev.active === false;
          const past = isPastSlot(ev.date, ev.time);
          return (
            <div className="card" key={ev.id}>
              {ev.imageUrl && <img src={ev.imageUrl} alt="" className="postimg" />}
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{ev.name}</h3>
                  <p className="muted">{fmtDate(new Date(`${ev.date}T12:00:00`))} · {ev.time} · {ev.price}€</p>
                </div>
                <span className={`pill ${past ? 'pill-gray' : closed ? 'pill-gray' : 'pill-sage'}`}>{past ? 'Pasado' : closed ? 'Cerrado' : 'Abierto'}</span>
              </div>
              {ev.description && <p className="muted">{ev.description}</p>}
              <p className="muted" style={{ marginTop: 6 }}>{attendees.length}/{ev.capacity || settings.defaultCapacity} apuntadas</p>
              {attendees.length > 0 && (
                <p className="muted" style={{ fontSize: 12 }}>
                  {attendees.map(a => students.find(s => s.id === a.studentId)?.name || 'Alumna eliminada').join(', ')}
                </p>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="linklike" onClick={() => toggleActive(ev)}>{closed ? 'Reabrir' : 'Cerrar inscripciones'}</button>
                <button className="linklike" style={{ color: 'var(--danger)' }} onClick={() => removeEvent(ev)}>Eliminar</button>
              </div>
            </div>
          );
        })}
    </>
  );
}

/* ---------------- MODALES ---------------- */
function BookingModal({ modal, bookings, saveBookings, purchases, savePurchases, bonos, me, pickProfile, activePurchaseFor, classCancellations, toast, onClose }) {
  const { freezes } = useContext(FreezeContext);
  const settings = useContext(SettingsContext);
  const { day, cls, dateIso } = modal;
  // Evita reservas/pagos duplicados por doble tap o doble clic: el estado de
  // React no llega a tiempo de deshabilitar el botón entre los dos clics, así
  // que se corta aquí, de forma síncrona, antes de crear nada.
  const submittingRef = useRef(false);

  function confirmBookingWithBono(purchaseId) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const next = purchases.map(p => p.id === purchaseId ? { ...p, classesUsed: (p.classesUsed || 0) + (p.classesTotal === null ? 0 : 1) } : p);
    savePurchases(next);
    saveBookings([...bookings, { id: uid(), studentId: me.id, day, time: cls.time, className: cls.name, date: dateIso, status: 'confirmada', paymentMethod: 'bono', purchaseId, createdAt: new Date().toISOString() }]);
    toast('Clase reservada con tu bono');
    onClose();
  }
  function confirmBookingSuelta(studentId) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const booking = { id: uid(), studentId, day, time: cls.time, className: cls.name, date: dateIso, status: 'pendiente_pago', paymentMethod: 'bizum', price: settings.claseSueltaPrice, createdAt: new Date().toISOString() };
    saveBookings([...bookings, booking]);
    toast(`Reserva registrada. Haz el Bizum al ${settings.bizumPhone} y Beatriz lo confirmará`);
    onClose();
    return booking;
  }
  async function confirmBookingSueltaCard(studentId) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const booking = { id: uid(), studentId, day, time: cls.time, className: cls.name, date: dateIso, status: 'pendiente_pago', paymentMethod: 'redsys', price: settings.claseSueltaPrice, createdAt: new Date().toISOString() };
    saveBookings([...bookings, booking]);
    try {
      await payWithRedsys({ kind: 'suelta', itemId: booking.id, studentId, amount: settings.claseSueltaPrice, concept: `${cls.name} (${day} ${cls.time})` });
    } catch (e) {
      submittingRef.current = false;
      toast('No se pudo iniciar el pago con tarjeta. Puedes pagar por Bizum.');
    }
  }
  function joinWaitlist() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const booking = { id: uid(), studentId: me.id, day, time: cls.time, className: cls.name, date: dateIso, status: 'en_espera', createdAt: new Date().toISOString() };
    saveBookings([...bookings, booking]);
    toast('Apuntada a la lista de espera. Te avisaremos por email y notificación si se libera una plaza.');
    onClose();
  }

  const capacity = cls.capacity || settings.defaultCapacity;
  const attendeeCount = dateIso ? bookings.filter(b => b.date === dateIso && b.time === cls.time && b.className === cls.name && occupiesSpot(b.status)).length : 0;

  let step2 = null;
  if (dateIso) {
    const full = attendeeCount >= capacity;
    const past = isPastSlot(dateIso, cls.time);
    const tooFarAhead = !past && isTooFarAhead(dateIso);
    const cancelled = isClassCancelled(classCancellations, dateIso, cls.time, cls.name);
    if (me) {
      const already = bookings.some(b => b.studentId === me.id && b.date === dateIso && b.time === cls.time && b.className === cls.name && occupiesSpot(b.status));
      if (cancelled) {
        step2 = <p className="muted" style={{ marginTop: 12 }}>Esta clase se ha cancelado para este día. Elige otra fecha.</p>;
      } else if (already) {
        step2 = <p className="muted" style={{ marginTop: 12 }}>Ya tienes esta clase reservada ese día.</p>;
      } else if (past) {
        step2 = <p className="muted" style={{ marginTop: 12 }}>Esta clase ya ha pasado. Elige otra fecha u hora.</p>;
      } else if (tooFarAhead) {
        step2 = <p className="muted" style={{ marginTop: 12 }}>Esta clase solo se puede reservar con un máximo de {BOOKING_WINDOW_DAYS} días de antelación. Vuelve más cerca de la fecha.</p>;
      } else if (full) {
        const onWaitlist = bookings.some(b => b.studentId === me.id && b.date === dateIso && b.time === cls.time && b.className === cls.name && b.status === 'en_espera');
        step2 = onWaitlist ? (
          <p className="muted" style={{ marginTop: 12 }}>Ya estás en la lista de espera de esta clase. Te avisaremos si se libera una plaza.</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 12 }}>Esta clase ya está completa (máximo {capacity} alumnas).</p>
            <div className="optionbox" onClick={joinWaitlist}>
              <div className="t">Apuntarme a la lista de espera</div>
              <div className="s">Te avisamos por email y notificación si se libera una plaza</div>
            </div>
          </>
        );
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
            ) : purchases.some(p => p.studentId === me.id && p.status === 'confirmado' && isFrozenOn(freezes, p.id, dateIso))
              ? <p className="muted">Tu bono está congelado en esta fecha, así que no puedes usarlo.</p>
              : <p className="muted">No tienes un bono activo para esta fecha.</p>}
            <div className="optionbox" onClick={() => confirmBookingSueltaCard(me.id)}>
              <div className="t">Pagar con tarjeta ahora · {settings.claseSueltaPrice}€</div>
              <div className="s">Redirige a la pasarela de pago segura</div>
            </div>
            <div className="optionbox" onClick={() => confirmBookingSuelta(me.id)}>
              <div className="t">Pagar por Bizum · {settings.claseSueltaPrice}€</div>
              <div className="s">Al {settings.bizumPhone} — Beatriz lo confirma en cuanto lo recibe</div>
            </div>
          </>
        );
      }
    } else if (cancelled) {
      step2 = (
        <>
          <hr className="sep" />
          <p className="muted">Esta clase se ha cancelado para este día. Elige otra fecha.</p>
        </>
      );
    } else if (past) {
      step2 = (
        <>
          <hr className="sep" />
          <p className="muted">Esta clase ya ha pasado. Elige otra fecha u hora.</p>
        </>
      );
    } else if (tooFarAhead) {
      step2 = (
        <>
          <hr className="sep" />
          <p className="muted">Esta clase solo se puede reservar con un máximo de {BOOKING_WINDOW_DAYS} días de antelación. Vuelve más cerca de la fecha.</p>
        </>
      );
    } else if (full) {
      step2 = (
        <>
          <hr className="sep" />
          <p className="muted">Esta clase ya está completa (máximo {capacity} alumnas). Elige otra fecha.</p>
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
        <p className="muted">{fmtDate(new Date(dateIso))}{dateIso && ` · ${attendeeCount}/${capacity} apuntadas`}</p>
        {step2}
      </div>
    </div>
  );
}

function NoProfileBookingStep({ dateIso, pickProfile, toast, onConfirmPuntual, onConfirmPuntualCard }) {
  const settings = useContext(SettingsContext);
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
      <p className="muted">Esta clase se paga como clase suelta ({settings.claseSueltaPrice}€). ¿Cómo quieres reservarla?</p>
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
          }}>Pagar por Bizum al {settings.bizumPhone}</button>
        </>
      )}
    </>
  );
}

function BonoModal({ modal, me, purchases, savePurchases, toast, onClose }) {
  const settings = useContext(SettingsContext);
  const b = modal.bono;
  const trimestre = !!modal.trimestre;
  const tri = bonoTrimestre(b);
  const price = trimestre && tri ? tri.price : b.price;
  const classesTotal = b.classes === null ? null : (trimestre ? b.classes * 3 : b.classes);
  const termDays = trimestre ? 90 : 30;
  const label = trimestre ? `${b.name} · Trimestre` : b.name;
  const [paying, setPaying] = useState(false);
  // Doble protección frente a duplicados: el ref corta un doble tap/clic
  // síncrono, y reutilizar una solicitud pendiente ya existente evita crear
  // otra si vuelve a intentarlo tras cerrar y reabrir (p.ej. pago abandonado).
  const submittingRef = useRef(false);

  function createPendingPurchase(paymentMethod) {
    const existing = purchases.find(p => p.studentId === me.id && p.bonoId === b.id && p.trimestre === trimestre && p.status === 'pendiente');
    if (existing) return existing;
    const purchase = {
      id: uid(), studentId: me.id, bonoId: b.id, price, trimestre,
      classesTotal, classesUsed: 0,
      status: 'pendiente', paymentMethod, purchaseDate: new Date().toISOString(), expiryDate: addDays(new Date(), termDays).toISOString()
    };
    savePurchases([...purchases, purchase]);
    return purchase;
  }

  async function handleCardPayment() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPaying(true);
    const purchase = createPendingPurchase('redsys');
    try {
      await payWithRedsys({ kind: 'bono', itemId: purchase.id, studentId: me.id, amount: price, concept: label });
    } catch (e) {
      submittingRef.current = false;
      setPaying(false);
      toast('No se pudo iniciar el pago con tarjeta. Puedes pagar por Bizum.');
    }
  }
  function handleBizum() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    createPendingPurchase('bizum');
    toast(`Bono solicitado. Haz el Bizum al ${settings.bizumPhone} y Beatriz lo confirmará`);
    onClose();
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
        <button className="btn btn-ghost" disabled={paying} onClick={handleBizum}>Pagar por Bizum al {settings.bizumPhone}</button>
      </div>
    </div>
  );
}

function EventModal({ modal, me, bookings, saveBookings, toast, onClose }) {
  const settings = useContext(SettingsContext);
  const ev = modal.event;
  const [paying, setPaying] = useState(false);
  const submittingRef = useRef(false);

  const capacity = ev.capacity || settings.defaultCapacity;
  const attendeeCount = bookings.filter(b => b.date === ev.date && b.time === ev.time && b.className === ev.name && occupiesSpot(b.status)).length;
  const full = attendeeCount >= capacity;
  const already = bookings.some(b => b.studentId === me.id && b.date === ev.date && b.time === ev.time && b.className === ev.name && occupiesSpot(b.status));
  const past = isPastSlot(ev.date, ev.time);

  function createBooking(paymentMethod) {
    const booking = {
      id: uid(), studentId: me.id, day: dayNameForDate(new Date(`${ev.date}T12:00:00`)), time: ev.time, className: ev.name,
      date: ev.date, status: 'pendiente_pago', paymentMethod, price: ev.price, eventId: ev.id, createdAt: new Date().toISOString()
    };
    saveBookings([...bookings, booking]);
    return booking;
  }

  async function handleCardPayment() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPaying(true);
    const booking = createBooking('redsys');
    try {
      await payWithRedsys({ kind: 'suelta', itemId: booking.id, studentId: me.id, amount: ev.price, concept: ev.name });
    } catch (e) {
      submittingRef.current = false;
      setPaying(false);
      toast('No se pudo iniciar el pago con tarjeta. Puedes pagar por Bizum.');
    }
  }
  function handleBizum() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    createBooking('bizum');
    toast(`Apuntada a ${ev.name}. Haz el Bizum al ${settings.bizumPhone} y Beatriz lo confirmará`);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>{ev.name}</h3>
        <p className="muted">{fmtDate(new Date(`${ev.date}T12:00:00`))} · {ev.time} · <b>{ev.price}€</b></p>
        {ev.description && <p className="muted">{ev.description}</p>}
        <hr className="sep" />
        {already ? (
          <p className="muted">Ya estás apuntada a este evento.</p>
        ) : past ? (
          <p className="muted">Este evento ya ha pasado.</p>
        ) : full ? (
          <p className="muted">Este evento ya está completo (máximo {capacity} plazas).</p>
        ) : (
          <>
            <button className="btn btn-primary" disabled={paying} onClick={handleCardPayment}>
              {paying ? 'Redirigiendo a la pasarela…' : `Pagar con tarjeta ahora · ${ev.price}€`}
            </button>
            <p className="muted" style={{ textAlign: 'center', margin: '10px 0' }}>o</p>
            <button className="btn btn-ghost" disabled={paying} onClick={handleBizum}>Pagar por Bizum al {settings.bizumPhone}</button>
          </>
        )}
      </div>
    </div>
  );
}

function FreezeModal({ modal, me, bookings, toast, onClose }) {
  const settings = useContext(SettingsContext);
  const { freezes, saveFreezes } = useContext(FreezeContext);
  const purchase = modal.purchase;
  const maxDays = settings.freezeMaxDays || 30;
  const todayIso = isoDate(new Date());
  const options = Array.from(new Set([...[7, 14, 21, 30].filter(d => d <= maxDays), maxDays])).sort((a, b) => a - b);
  const [startDate, setStartDate] = useState(todayIso);
  const [days, setDays] = useState(options[0]);
  const [paying, setPaying] = useState(false);
  const submittingRef = useRef(false);

  const endDate = startDate ? isoDate(addDays(new Date(`${startDate}T12:00:00`), days - 1)) : '';
  let error = null;
  if (!startDate || startDate < todayIso) error = 'Elige una fecha de inicio desde hoy en adelante.';
  else if (new Date(purchase.expiryDate) < new Date(`${startDate}T00:00:00`)) error = 'Tu bono caduca antes de esa fecha.';
  else if (freezesOf(freezes, purchase.id).some(f => startDate <= f.endDate && endDate >= f.startDate)) error = 'Esas fechas se solapan con otra congelación de este bono.';
  else {
    const clash = bookingsInFreeze(bookings, { studentId: me.id, purchaseId: purchase.id, startDate, endDate });
    if (clash.length > 0) error = `Tienes ${clash.length} clase${clash.length === 1 ? '' : 's'} reservada${clash.length === 1 ? '' : 's'} con tu bono en esas fechas. Cancélala${clash.length === 1 ? '' : 's'} primero desde Perfil → Mis próximas clases.`;
  }

  function createFreeze(paymentMethod) {
    const freeze = {
      id: uid(), purchaseId: purchase.id, studentId: me.id, startDate, endDate, days,
      price: settings.freezePrice, paymentMethod, status: 'pendiente', by: 'alumna', createdAt: new Date().toISOString()
    };
    saveFreezes([...freezes, freeze]);
    return freeze;
  }
  async function handleCardPayment() {
    if (submittingRef.current || error) return;
    submittingRef.current = true;
    setPaying(true);
    const freeze = createFreeze('redsys');
    try {
      await payWithRedsys({ kind: 'freeze', itemId: freeze.id, studentId: me.id, amount: settings.freezePrice, concept: `Congelar bono (${days} días)` });
    } catch (e) {
      submittingRef.current = false;
      setPaying(false);
      toast('No se pudo iniciar el pago con tarjeta. Puedes pagar por Bizum.');
    }
  }
  function handleBizum() {
    if (submittingRef.current || error) return;
    submittingRef.current = true;
    createFreeze('bizum');
    toast(`Congelación solicitada. Haz el Bizum al ${settings.bizumPhone} y Beatriz la confirmará`);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>Congelar mi bono</h3>
        <p className="muted">Si no vas a poder venir (lesión, viaje…), congela tu bono: durante esos días no podrás usarlo y su caducidad se alarga el mismo número de días. Coste: <b>{settings.freezePrice}€</b>.</p>
        <label>Desde</label>
        <input type="date" value={startDate} min={todayIso} onChange={e => setStartDate(e.target.value)} />
        <label>Durante</label>
        <select value={days} onChange={e => setDays(Number(e.target.value))}>
          {options.map(d => <option key={d} value={d}>{d} días</option>)}
        </select>
        {endDate && <p className="muted" style={{ marginTop: 8 }}>Congelado del {fmtIso(startDate)} al {fmtIso(endDate)}. Tu bono caducará el {fmtDate(addDays(new Date(purchase.expiryDate), days))}.</p>}
        {error ? <p className="muted" style={{ color: 'var(--danger)' }}>{error}</p> : (
          <>
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={paying} onClick={handleCardPayment}>
              {paying ? 'Redirigiendo a la pasarela…' : `Pagar con tarjeta ahora · ${settings.freezePrice}€`}
            </button>
            <p className="muted" style={{ textAlign: 'center', margin: '10px 0' }}>o</p>
            <button className="btn btn-ghost" disabled={paying} onClick={handleBizum}>Pagar por Bizum al {settings.bizumPhone}</button>
          </>
        )}
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

function AdminAjustes({ settings, saveSettings, adminToken, onAdminLogout, toast }) {
  const [form, setForm] = useState({
    claseSueltaPrice: String(settings.claseSueltaPrice),
    bizumPhone: settings.bizumPhone,
    whatsappPhone: settings.whatsappPhone,
    defaultCapacity: String(settings.defaultCapacity),
    freezePrice: String(settings.freezePrice),
    freezeMaxDays: String(settings.freezeMaxDays)
  });
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [changingPin, setChangingPin] = useState(false);

  function saveGeneral() {
    saveSettings({
      claseSueltaPrice: Number(form.claseSueltaPrice) || settings.claseSueltaPrice,
      bizumPhone: form.bizumPhone.trim(),
      whatsappPhone: form.whatsappPhone.trim(),
      defaultCapacity: Number(form.defaultCapacity) || settings.defaultCapacity,
      freezePrice: Number(form.freezePrice) || settings.freezePrice,
      freezeMaxDays: Math.round(Number(form.freezeMaxDays)) || settings.freezeMaxDays
    });
    toast('Ajustes guardados');
  }

  async function handleChangePin() {
    if (!currentPin || !newPin) { toast('Rellena el PIN actual y el nuevo'); return; }
    if (newPin !== newPin2) { toast('Los dos PIN nuevos no coinciden'); return; }
    if (newPin.length < 4) { toast('El PIN nuevo debe tener al menos 4 caracteres'); return; }
    setChangingPin(true);
    const res = await changeAdminPin(currentPin, newPin, adminToken);
    setChangingPin(false);
    if (res.ok) {
      toast('PIN cambiado correctamente');
      setCurrentPin(''); setNewPin(''); setNewPin2('');
    } else {
      toast(res.error || 'No se pudo cambiar el PIN');
    }
  }

  return (
    <>
      <div className="sectionlabel" style={{ marginTop: 0 }}>Precios y contacto</div>
      <div className="card">
        <label>Precio de clase suelta (€)</label>
        <input type="number" value={form.claseSueltaPrice} onChange={e => setForm({ ...form, claseSueltaPrice: e.target.value })} />
        <label>Teléfono de Bizum</label>
        <input type="text" value={form.bizumPhone} onChange={e => setForm({ ...form, bizumPhone: e.target.value })} />
        <label>Teléfono de WhatsApp (formato internacional sin +, ej. 34600123456)</label>
        <input type="text" value={form.whatsappPhone} onChange={e => setForm({ ...form, whatsappPhone: e.target.value })} />
        <label>Aforo por defecto de una clase</label>
        <input type="number" value={form.defaultCapacity} onChange={e => setForm({ ...form, defaultCapacity: e.target.value })} />
        <label>Precio de congelar un bono (€) — Beatriz lo congela gratis cuando quiera</label>
        <input type="number" min="1" value={form.freezePrice} onChange={e => setForm({ ...form, freezePrice: e.target.value })} />
        <label>Máximo de días por congelación</label>
        <input type="number" min="1" value={form.freezeMaxDays} onChange={e => setForm({ ...form, freezeMaxDays: e.target.value })} />
        <button className="btn btn-sage btn-sm" style={{ marginTop: 10 }} onClick={saveGeneral}>Guardar ajustes</button>
      </div>

      <div className="sectionlabel">Seguridad</div>
      <div className="card">
        <label>PIN actual</label>
        <input type="password" value={currentPin} onChange={e => setCurrentPin(e.target.value)} />
        <label>PIN nuevo</label>
        <input type="password" value={newPin} onChange={e => setNewPin(e.target.value)} />
        <label>Repite el PIN nuevo</label>
        <input type="password" value={newPin2} onChange={e => setNewPin2(e.target.value)} />
        <button className="btn btn-sage btn-sm" style={{ marginTop: 10 }} disabled={changingPin} onClick={handleChangePin}>
          {changingPin ? 'Cambiando…' : 'Cambiar PIN'}
        </button>
        <hr className="sep" />
        <button className="linklike" onClick={onAdminLogout}>Cerrar sesión de administradora</button>
      </div>
    </>
  );
}
