import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { getData, setData } from './api.js';
import { payWithRedsys } from './redsys.js';
import { registerServiceWorker, subscribeToPush, unsubscribeFromPush, getCurrentSubscription, pushSupported } from './push.js';

const DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Domingo'];
const DAY_INDEX = { Domingo: 0, Lunes: 1, Martes: 2, 'Miércoles': 3, Jueves: 4, Viernes: 5 };

const SCHEDULE = {
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

const BONOS = [
  { id: 'bono4', name: 'Bono 4', desc: '4 clases al mes · 1 día a la semana', price: 60, classes: 4 },
  { id: 'bono6', name: 'Bono 6', desc: '6 clases al mes · ≥2 días a la semana', price: 80, classes: 6 },
  { id: 'bono8', name: 'Bono 8', desc: '8 clases al mes · 2 días a la semana', price: 95, classes: 8 },
  { id: 'bono10', name: 'Bono 10', desc: '10 clases al mes', price: 105, classes: 10 },
  { id: 'ilimitado', name: 'Bono ilimitado', desc: 'Clases ilimitadas', price: 150, classes: null }
];
const CLASE_SUELTA_PRECIO = 20;
const BIZUM_PHONE = '691750534';
const ADMIN_PIN = 'ADITI2026';
const HOW_FOUND = ['Instagram', 'Facebook', 'Google', 'Recomendación de una amiga', 'Al pasar por el centro', 'Cartel o flyer', 'Web aditifunctionalyoga.es', 'Otro'];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function todayDayName() {
  const idx = new Date().getDay();
  return Object.keys(DAY_INDEX).find(k => DAY_INDEX[k] === idx) || 'Lunes';
}
function fmtDate(d) { return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function nextDatesForDay(dayName, count) {
  const targetIdx = DAY_INDEX[dayName];
  const res = [];
  for (let i = 0; i < 60 && res.length < count; i++) {
    const cand = addDays(new Date(), i);
    if (cand.getDay() === targetIdx) res.push(cand);
  }
  return res;
}
function bonoName(id) { const b = BONOS.find(x => x.id === id); return b ? b.name : id; }

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('muro');
  const [students, setStudents] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [wallPosts, setWallPosts] = useState([]);
  const [myId, setMyId] = useState(() => localStorage.getItem('aditi_myId') || null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedDay, setSelectedDay] = useState(todayDayName());
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
        getData('students'), getData('bookings'), getData('purchases'), getData('wallPosts')
      ]).then(([s, b, p, w]) => {
        if (cancelled) return;
        setStudents(s || []);
        setBookings(b || []);
        setPurchases(p || []);
        setWallPosts(w || []);
        setLoading(false);
      }).catch(() => { if (!cancelled) setLoading(false); });
    }
    loadAll();
    const interval = setInterval(loadAll, 5000);
    function onFocus() { loadAll(); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAll(); });
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, []);

  function toast(msg) {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }

  function saveStudents(next) { setStudents(next); setData('students', next); }
  function saveBookings(next) { setBookings(next); setData('bookings', next); }
  function savePurchases(next) { setPurchases(next); setData('purchases', next); }
  function saveWallPosts(next) { setWallPosts(next); setData('wallPosts', next); }
  function pickProfile(id) { setMyId(id); localStorage.setItem('aditi_myId', id); }
  function clearProfile() { setMyId(null); localStorage.removeItem('aditi_myId'); }

  const me = myId ? students.find(s => s.id === myId) : null;

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
            selectedDay={selectedDay} setSelectedDay={setSelectedDay}
            onPickClass={(day, cls) => setModal({ type: 'booking', day, cls, dateIso: null, path: null })}
          />
        ) : tab === 'bonos' ? (
          <BonosTab me={me} activePurchaseFor={activePurchaseFor} purchases={purchases}
            onRequestBono={(bono) => {
              if (!me) { toast('Completa tu perfil antes de solicitar un bono'); setTab('perfil'); return; }
              setModal({ type: 'bono', bono });
            }} />
        ) : tab === 'perfil' ? (
          <PerfilTab me={me} students={students} saveStudents={saveStudents}
            pickProfile={pickProfile} clearProfile={clearProfile}
            isAdmin={isAdmin} setIsAdmin={setIsAdmin} setTab={setTab} toast={toast} />
        ) : tab === 'admin' ? (
          <AdminTab adminTab={adminTab} setAdminTab={setAdminTab}
            students={students} saveStudents={saveStudents} bookings={bookings} purchases={purchases} wallPosts={wallPosts}
            activePurchaseFor={activePurchaseFor}
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
          modal={modal} setModal={setModal} students={students} saveStudents={saveStudents}
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
      <p>{p.content}</p>
    </div>
  ));
}

/* ---------------- HORARIO ---------------- */
function HorarioTab({ selectedDay, setSelectedDay, onPickClass }) {
  const classes = SCHEDULE[selectedDay] || [];
  return (
    <>
      <div className="daychips">
        {DAYS_ORDER.map(d => (
          <div key={d} className={`chip ${selectedDay === d ? 'active' : ''}`} onClick={() => setSelectedDay(d)}>{d}</div>
        ))}
      </div>
      {classes.length === 0 ? (
        <div className="empty">No hay clases programadas este día.</div>
      ) : classes.map((c, idx) => (
        <div className="classcard" key={idx} onClick={() => onPickClass(selectedDay, c)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <div className="time">{c.time}</div>
            <div className="name">{c.name}</div>
          </div>
          <span className={`pill ${CLASS_STYLE[c.name] || 'pill-gray'}`}>Reservar</span>
        </div>
      ))}
    </>
  );
}

/* ---------------- BONOS ---------------- */
function BonosTab({ me, activePurchaseFor, purchases, onRequestBono }) {
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
              <h3>{bonoName(active.bonoId)}</h3>
              <p className="muted">Clases disponibles: <b>{active.classesTotal === null ? 'Ilimitadas' : `${active.classesTotal - active.classesUsed} de ${active.classesTotal}`}</b></p>
              <p className="muted">Válido hasta {fmtDate(new Date(active.expiryDate))}</p>
            </div>
          ) : pendiente ? (
            <div className="card"><h3>{bonoName(pendiente.bonoId)}</h3><p className="muted">Solicitado, pendiente de confirmar el pago con Beatriz.</p></div>
          ) : (
            <div className="empty">No tienes ningún bono activo ahora mismo.</div>
          )}
        </>
      )}
      <div className="sectionlabel">Elige un bono</div>
      {BONOS.map(b => (
        <div className="card" key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><h3>{b.name}</h3><p className="muted">{b.desc}</p></div>
          <div style={{ textAlign: 'right' }}>
            <div className="serif" style={{ fontSize: 19, fontWeight: 600, color: 'var(--plum)' }}>{b.price}€</div>
            <button className="btn btn-sage btn-sm" style={{ marginTop: 6 }} onClick={() => onRequestBono(b)}>Solicitar</button>
          </div>
        </div>
      ))}
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
      <label>Teléfono</label>
      <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="600123456" />
      <label>Fecha de nacimiento</label>
      <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)} />
      <label>¿Cómo nos has conocido?</label>
      <select value={howFound} onChange={e => setHowFound(e.target.value)}>
        <option value="">Selecciona una opción</option>
        {HOW_FOUND.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => {
        if (!name.trim() || !phone.trim()) return onSave(null, 'Nombre y teléfono son obligatorios');
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

function PerfilTab({ me, students, saveStudents, pickProfile, clearProfile, isAdmin, setIsAdmin, setTab, toast }) {
  const [searchPhone, setSearchPhone] = useState('');

  function handleSave(data, error) {
    if (error) { toast(error); return; }
    if (me) {
      const next = students.map(s => s.id === me.id ? { ...s, ...data } : s);
      saveStudents(next);
    } else {
      const newStudent = { id: uid(), ...data, createdAt: new Date().toISOString() };
      saveStudents([...students, newStudent]);
      pickProfile(newStudent.id);
    }
    toast('Perfil guardado');
  }

  function handleSearch() {
    if (!searchPhone.trim()) { toast('Escribe un teléfono para buscar'); return; }
    const found = students.find(s => s.phone.replace(/\s/g, '') === searchPhone.replace(/\s/g, ''));
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
            <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={handleSearch}>Buscar mi perfil</button>
          </div>
          <div className="sectionlabel">Crear perfil nuevo</div>
          <ProfileForm existing={null} onSave={handleSave} />
        </>
      )}
      <hr className="sep" />
      {isAdmin ? (
        <button className="btn btn-outline" onClick={() => { setIsAdmin(false); setTab('perfil'); }}>Salir del panel de Beatriz</button>
      ) : (
        <button className="linklike" onClick={() => {
          const pin = prompt('Introduce el PIN de acceso de Beatriz:');
          if (pin === ADMIN_PIN) { setIsAdmin(true); setTab('admin'); }
          else if (pin !== null) toast('PIN incorrecto');
        }}>¿Eres Beatriz? Acceso profesora</button>
      )}
    </>
  );
}

/* ---------------- ADMIN ---------------- */
function AdminTab({ adminTab, setAdminTab, students, saveStudents, bookings, purchases, wallPosts, activePurchaseFor, savePurchases, saveBookings, saveWallPosts, toast }) {
  const tabs = [
    { id: 'alumnas', label: 'Alumnas' },
    { id: 'bonospend', label: 'Bonos pendientes' },
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
      {adminTab === 'alumnas' && (
        students.length === 0 ? <div className="empty">Todavía no hay alumnas registradas.</div> :
        [...students].sort((a, b) => a.name.localeCompare(b.name)).map(s => {
          const active = activePurchaseFor(s.id);
          const total = bookings.filter(b => b.studentId === s.id).length;
          return (
            <div className="card" key={s.id}>
              <h3>{s.name} {s.isPuntual && <span className="pill pill-peach">Puntual</span>}</h3>
              <p className="muted">{s.phone} · {s.email}</p>
              <p className="muted">Cumpleaños: {s.birthday || '—'} · Conoció por: {s.howFound || '—'}</p>
              <div className="row" style={{ marginTop: 8 }}>
                <span className={`pill ${active ? 'pill-sage' : 'pill-gray'}`}>{active ? `${bonoName(active.bonoId)} activo` : 'Sin bono activo'}</span>
                <span className="pill pill-lav">{total} reservas totales</span>
                {typeof s.legacyReservas === 'number' && <span className="pill pill-gray">{s.legacyReservas} históricas (app anterior)</span>}
              </div>
            </div>
          );
        })
      )}
      {adminTab === 'bonospend' && (
        <>
          <div className="sectionlabel">Bonos por confirmar</div>
          {purchases.filter(p => p.status === 'pendiente').length === 0 ? <div className="empty">No hay bonos pendientes de pago.</div> :
            purchases.filter(p => p.status === 'pendiente').map(p => {
              const s = students.find(x => x.id === p.studentId);
              return (
                <div className="card" key={p.id}>
                  <h3>{bonoName(p.bonoId)} <span className="pill pill-lav">{p.paymentMethod === 'redsys' ? 'Tarjeta' : 'Bizum'}</span></h3>
                  <p className="muted">{s ? s.name : 'Alumna eliminada'} · {s ? s.phone : ''}</p>
                  <p className="muted">Solicitado el {fmtDate(new Date(p.purchaseDate))}</p>
                  <button className="btn btn-sage btn-sm" style={{ marginTop: 8 }} onClick={() => {
                    const next = purchases.map(x => x.id === p.id ? { ...x, status: 'confirmado', expiryDate: addDays(new Date(), 30).toISOString() } : x);
                    savePurchases(next);
                    toast('Bono confirmado');
                  }}>Marcar como pagado</button>
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
                  <button className="btn btn-sage btn-sm" style={{ marginTop: 8 }} onClick={() => {
                    const next = bookings.map(x => x.id === b.id ? { ...x, status: 'confirmada' } : x);
                    saveBookings(next);
                    toast('Clase suelta confirmada');
                  }}>Marcar como pagada</button>
                </div>
              );
            })}
        </>
      )}
      {adminTab === 'muro' && <AdminMuro wallPosts={wallPosts} saveWallPosts={saveWallPosts} toast={toast} />}
      {adminTab === 'importar' && <AdminImport students={students} saveStudents={saveStudents} toast={toast} />}
    </>
  );
}

function AdminMuro({ wallPosts, saveWallPosts, toast }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  return (
    <>
      <div className="card">
        <label>Título</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej. Clase especial de luna llena" />
        <label>Mensaje</label>
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Escribe el aviso para todas las alumnas" />
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => {
          if (!title.trim() || !content.trim()) { toast('Escribe un título y un mensaje'); return; }
          saveWallPosts([...wallPosts, { id: uid(), title: title.trim(), content: content.trim(), date: new Date().toISOString() }]);
          setTitle(''); setContent('');
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
          <h3>{p.title}</h3><p>{p.content}</p>
          <button className="linklike" style={{ color: 'var(--danger)', marginTop: 8 }}
            onClick={() => saveWallPosts(wallPosts.filter(x => x.id !== p.id))}>Eliminar</button>
        </div>
      ))}
    </>
  );
}

/* ---------------- MODALES ---------------- */
function BookingModal({ modal, setModal, students, saveStudents, bookings, saveBookings, purchases, savePurchases, me, pickProfile, activePurchaseFor, toast, onClose }) {
  const { day, cls, dateIso } = modal;
  const dates = nextDatesForDay(day, 4);

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
    if (me) {
      const already = bookings.some(b => b.studentId === me.id && b.date === dateIso && b.time === cls.time && b.className === cls.name && b.status !== 'cancelada');
      if (already) {
        step2 = <p className="muted" style={{ marginTop: 12 }}>Ya tienes esta clase reservada ese día.</p>;
      } else {
        const active = activePurchaseFor(me.id, new Date(dateIso));
        step2 = (
          <>
            <hr className="sep" />
            {active ? (
              <div className="optionbox" onClick={() => confirmBookingWithBono(active.id)}>
                <div className="t">Usar mi {bonoName(active.bonoId)}</div>
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
    } else {
      step2 = (
        <NoProfileBookingStep
          dateIso={dateIso} students={students} saveStudents={saveStudents}
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
        <p className="muted">Elige la fecha en la que quieres asistir.</p>
        {dates.map(d => {
          const iso = isoDate(d);
          return (
            <button key={iso} className={`datebtn ${dateIso === iso ? 'selected' : ''}`}
              onClick={() => setModal({ ...modal, dateIso: iso })}>{fmtDate(d)}</button>
          );
        })}
        {step2}
      </div>
    </div>
  );
}

function NoProfileBookingStep({ dateIso, students, saveStudents, pickProfile, toast, onConfirmPuntual, onConfirmPuntualCard }) {
  const [path, setPath] = useState(null);
  const [searchPhone, setSearchPhone] = useState('');
  const [searchMsg, setSearchMsg] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  function makeQuickStudent() {
    const quick = { id: uid(), name: name.trim(), email: '', phone: phone.trim(), birthday: '', howFound: '', isPuntual: true, createdAt: new Date().toISOString() };
    saveStudents([...students, quick]);
    return quick;
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
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => {
            const found = students.find(s => s.phone.replace(/\s/g, '') === searchPhone.replace(/\s/g, ''));
            if (found) { pickProfile(found.id); toast(`Perfil encontrado, ¡hola ${found.name.split(' ')[0]}!`); }
            else setSearchMsg('No encontramos ese teléfono.');
          }}>Buscar</button>
          {searchMsg && <div className="muted" style={{ marginTop: 8 }}>{searchMsg}</div>}
        </>
      )}
      {path === 'puntual' && (
        <>
          <label>Nombre</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellidos" />
          <label>Teléfono</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="600123456" />
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10, marginRight: 8 }} onClick={() => {
            if (!name.trim() || !phone.trim()) { toast('Nombre y teléfono son obligatorios'); return; }
            const quick = makeQuickStudent();
            onConfirmPuntualCard(quick.id);
          }}>Pagar con tarjeta</button>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => {
            if (!name.trim() || !phone.trim()) { toast('Nombre y teléfono son obligatorios'); return; }
            const quick = makeQuickStudent();
            onConfirmPuntual(quick.id);
          }}>Pagar por Bizum al {BIZUM_PHONE}</button>
        </>
      )}
    </>
  );
}

function BonoModal({ modal, me, purchases, savePurchases, toast, onClose }) {
  const b = modal.bono;
  const [paying, setPaying] = useState(false);

  function createPendingPurchase(paymentMethod) {
    const purchase = {
      id: uid(), studentId: me.id, bonoId: b.id, price: b.price,
      classesTotal: b.classes === null ? null : b.classes, classesUsed: 0,
      status: 'pendiente', paymentMethod, purchaseDate: new Date().toISOString(), expiryDate: addDays(new Date(), 30).toISOString()
    };
    savePurchases([...purchases, purchase]);
    return purchase;
  }

  async function handleCardPayment() {
    setPaying(true);
    const purchase = createPendingPurchase('redsys');
    try {
      await payWithRedsys({ kind: 'bono', itemId: purchase.id, studentId: me.id, amount: b.price, concept: b.name });
    } catch (e) {
      setPaying(false);
      toast('No se pudo iniciar el pago con tarjeta. Puedes pagar por Bizum.');
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>{b.name}</h3>
        <p className="muted">{b.desc} · <b>{b.price}€</b></p>
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
