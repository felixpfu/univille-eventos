import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  CalendarRange,
  LayoutGrid,
  MapPin,
  ArrowUpRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sun,
  Moon,
  LogIn,
  LogOut,
  UserRound,
  Clock3,
  X,
  Check,
  Search,
  List,
  SlidersHorizontal,
  ArrowLeft,
  FileText,
  ShieldCheck,
  Building2,
  CheckCircle2,
  CircleHelp,
  LockKeyhole,
  LoaderCircle,
  Send,
  Save,
  Users,
  Download,
  Ban,
  Trash2,
  Pencil,
  Info,
  Bell,
  Mail,
} from "lucide-react";
import Admin from "./Admin.jsx";
import "./styles.css";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const STATUS = {
  draft: "Rascunho",
  pending: "Aguardando aprovação",
  rejected: "Rejeitado",
  approved: "Aprovado",
  cancelled: "Cancelado",
};
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2026, i, 1).toLocaleDateString("pt-BR", { month: "long" }),
);
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const dateFormat = (
  date,
  opts = { day: "2-digit", month: "short", year: "numeric" },
) =>
  date
    ? new Date(date + "T12:00:00").toLocaleDateString("pt-BR", opts)
    : "Data a definir";
const blank = () => ({
  name: "",
  themeId: "",
  date: "",
  startTime: "",
  endTime: "",
  roomId: "",
  courseId: "",
  requesterName: "",
  speaker: "",
  audience: "",
  organizer: "",
  audienceCourseId: "",
  audienceSemester: "",
  justification: "",
  objective: "",
  ceremony: null,
  registration: null,
  certificates: null,
  resourceIds: [],
  notes: "",
});
async function api(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Não foi possível conectar ao sistema. Tente novamente.");
  }
  if (!res.ok) {
    const err = new Error(data.error || "Não foi possível concluir a ação.");
    err.fields = data.fields;
    err.code = data.code;
    err.status = res.status;
    if (data.code === "UNAUTHENTICATED")
      window.dispatchEvent(new Event("univille-session-expired"));
    throw err;
  }
  return data;
}
function IconButton({ children, label, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
function Brand() {
  return (
    <div className="brand">
      <img
        className="official-logo"
        src={`${import.meta.env.BASE_URL}branding/univille-logo.png`}
        alt="Univille"
        width="221"
        height="50"
      />
      <span className="brand-caption">Agenda de eventos</span>
    </div>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    el.focus();
    const key = (e) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const all = el.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
        );
        if (!all.length) {
          e.preventDefault();
          return;
        }
        const first = all[0],
          last = all[all.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === el)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">AGENDA UNIVILLE</span>
            <h2>{title}</h2>
          </div>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={21} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}
function App() {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false),
    [page, setPage] = useState("agenda"),
    [metadata, setMetadata] = useState({
      themes: [],
      rooms: [],
      resources: [],
      courses: [],
      costCenters: [],
    }),
    [events, setEvents] = useState([]),
    [requests, setRequests] = useState([]),
    [modal, setModal] = useState(null),
    [emailAction, setEmailAction] = useState(readEmailAction),
    [selected, setSelected] = useState(null),
    [afterSave, setAfterSave] = useState(null),
    [toast, setToast] = useState(null),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(false),
    [theme, setTheme] = useState(
      () => localStorage.getItem("univille-theme") || "light",
    );
  const notify = (message, type = "success") => setToast({ message, type });
  useEffect(() => {
    const read = () => setEmailAction(readEmailAction());
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setPage("agenda");
      setModal(null);
      setRequests([]);
      notify("Sua sessão terminou. Entre novamente para continuar.", "error");
    };
    window.addEventListener("univille-session-expired", expired);
    return () =>
      window.removeEventListener("univille-session-expired", expired);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("univille-theme", theme);
  }, [theme]);
  const refreshMetadata = async () => {
    const data = await api("/metadata");
    setMetadata(data);
    return data;
  };
  const refresh = async () => {
    setLoading(true);
    try {
      const [ev, me] = await Promise.all([api("/events"), api("/auth/me")]);
      setEvents(ev.events);
      setUser(me.user);
      if (!me.user && ["admin", "requests"].includes(page)) setPage("agenda");
      await refreshMetadata();
      if (me.user && me.user.role !== "visitor") {
        const mine = await api("/requests");
        setRequests(mine.requests);
      } else setRequests([]);
      setLoadError("");
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setReady(true);
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, []);
  const openRequest = (request, callback) => {
    setSelected(request);
    setAfterSave(() => callback);
    setModal("request");
  };
  const saved = async () => {
    setModal(null);
    setSelected(null);
    await refresh();
    afterSave?.();
    setAfterSave(null);
  };
  const navigate = (p) => {
    setPage(p);
    setSelected(null);
    setModal(null);
  };
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setRequests([]);
      navigate("agenda");
      await refreshMetadata();
      notify("Você saiu da sua conta.");
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const requester = user && ["requester", "admin"].includes(user.role);
  const startRequest = () => {
    if (requester) {
      setSelected(null);
      setModal("request");
    } else if (user)
      notify(
        "Sua conta é de visitante. Solicite à administração a alteração para o perfil solicitante.",
        "error",
      );
    else setModal("login");
  };
  return (
    <>
      <a className="skip-link" href="#main">
        Ir para o conteúdo
      </a>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="brand-button"
            onClick={() => navigate("agenda")}
            aria-label="Página inicial"
          >
            <Brand />
          </button>
          <nav className="header-nav" aria-label="Navegação principal">
            <button
              className={page === "agenda" ? "active" : ""}
              onClick={() => navigate("agenda")}
            >
              Eventos
            </button>
            <button
              className={page === "spaces" ? "active" : ""}
              onClick={() => navigate("spaces")}
            >
              Espaços
            </button>
            {requester && (
              <button
                className={page === "requests" ? "active" : ""}
                onClick={() => navigate("requests")}
              >
                Minhas solicitações
              </button>
            )}
            {user?.role === "admin" && (
              <button
                className={page === "admin" ? "active" : ""}
                onClick={() => navigate("admin")}
              >
                Administração
              </button>
            )}
          </nav>
          <div className="header-actions">
            <IconButton
              label={
                theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"
              }
              onClick={() =>
                setTheme((t) => (t === "light" ? "dark" : "light"))
              }
            >
              {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
            </IconButton>
            {user && (
              <IconButton
                label="Preferências de e-mail"
                onClick={() => setModal("notifications")}
              >
                <Bell size={18} />
              </IconButton>
            )}
            <span className="role-pill">
              <UserRound size={14} />
              {user?.role === "admin"
                ? "Administrador"
                : user?.role === "requester"
                  ? "Solicitante"
                  : "Visitante"}
            </span>
            {user ? (
              <button
                className="button account-button"
                onClick={() => setModal("password")}
              >
                <span className="avatar">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span>{user.name.split(" ")[0]}</span>
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() => setModal("login")}
              >
                <LogIn size={15} />
                Entrar
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="app-shell">
        <main id="main" className="main-content">
          {loadError && (
            <div className="error-banner" role="alert">
              {loadError}
              <button onClick={refresh}>Tentar novamente</button>
            </div>
          )}
          {!ready ? (
            <div className="loading-state">
              <LoaderCircle className="spin" /> Carregando a agenda…
            </div>
          ) : page === "agenda" ? (
            <Agenda
              events={events}
              metadata={metadata}
              loading={loading}
              onRequest={startRequest}
              onNotifications={() => setModal(user ? "notifications" : "login")}
            />
          ) : page === "spaces" ? (
            <Spaces metadata={metadata} onRequest={startRequest} />
          ) : page === "requests" && requester ? (
            <MyRequests
              requests={requests}
              onOpen={openRequest}
              onNew={() => {
                setSelected(null);
                setModal("request");
              }}
            />
          ) : page === "admin" && user?.role === "admin" ? (
            <Admin
              api={api}
              metadata={metadata}
              onMetadata={refreshMetadata}
              onOpenRequest={openRequest}
              notify={notify}
              user={user}
              onAccountChanged={refresh}
            />
          ) : null}
          <footer className="footer">
            <span>
              © {new Date().getFullYear()} Agenda Univille{" "}
              <span className="footer-dot">·</span> Projeto acadêmico · !Null
            </span>
            <span>Campus São Bento do Sul · SC</span>
          </footer>
        </main>
      </div>
      {modal === "login" && (
        <AuthModal
          onClose={() => setModal(null)}
          onSuccess={async (nextUser) => {
            setModal(null);
            await refresh();
            setPage(
              nextUser.role === "admin"
                ? "admin"
                : nextUser.role === "requester"
                  ? "requests"
                  : "agenda",
            );
          }}
        />
      )}
      {modal === "password" && (
        <PasswordModal
          user={user}
          onClose={() => setModal(null)}
          onLogout={logout}
          notify={notify}
        />
      )}
      {modal === "request" && (
        <RequestModal
          request={selected}
          metadata={metadata}
          user={user}
          onClose={() => {
            setModal(null);
            refresh();
          }}
          onSaved={saved}
          notify={notify}
        />
      )}
      {modal === "notifications" && user && (
        <NotificationModal
          metadata={metadata}
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}
      {emailAction && (
        <EmailActionModal
          action={emailAction}
          notify={notify}
          onClose={() => {
            setEmailAction(null);
            window.history.replaceState(
              null,
              "",
              window.location.pathname + window.location.search,
            );
          }}
        />
      )}
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === "error" ? (
            <Info size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{toast.message}</span>
          <IconButton label="Fechar mensagem" onClick={() => setToast(null)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </>
  );
}
function Agenda({ events, metadata, onRequest, loading, onNotifications }) {
  const now = today().split("-").map(Number);
  const [monthOffset, setMonthOffset] = useState(0),
    [view, setView] = useState("calendar"),
    [search, setSearch] = useState(""),
    [themeId, setThemeId] = useState(""),
    [roomId, setRoomId] = useState(""),
    [courseId, setCourseId] = useState(""),
    [filters, setFilters] = useState(false),
    [day, setDay] = useState("");
  const date = new Date(now[0], now[1] - 1 + monthOffset, 1),
    month = date.getMonth(),
    year = date.getFullYear(),
    prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const matching = events.filter(
    (e) =>
      (!themeId || e.themeId === themeId) &&
      (!roomId || e.roomId === roomId) &&
      (!courseId || e.courseId === courseId) &&
      (!search ||
        [e.name, e.speaker, e.themeName, e.roomName, e.courseName, e.organizer]
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(search.toLocaleLowerCase("pt-BR"))),
  );
  const monthEvents = matching.filter((e) => e.date.startsWith(prefix));
  const visible = (view === "calendar" ? monthEvents : matching).filter(
    (e) => !day || e.date === day,
  );
  const hasFilters = search || themeId || roomId || courseId || day;
  return (
    <>
      <div className="page-heading agenda-heading">
        <div>
          <span className="eyebrow">UNIVILLE · CAMPUS SÃO BENTO DO SUL</span>
          <h1>Próximos eventos</h1>
          <p>
            Confira os encontros aprovados para este mês e os dois próximos.
            <br className="desktop-break" /> Conhecimento, experiências e novas
            conexões em um só lugar.
          </p>
        </div>
        <button className="button primary" onClick={onRequest}>
          <Plus size={17} /> Solicitar evento
        </button>
      </div>
      <section
        className="agenda-board"
        aria-label="Agenda de eventos aprovados"
      >
        <div className="agenda-board-top">
          <div className="view-switch" aria-label="Visualização da agenda">
            <button
              className={view === "calendar" ? "selected" : ""}
              aria-pressed={view === "calendar"}
              onClick={() => {
                setView("calendar");
                setDay("");
              }}
            >
              <CalendarDays size={17} />
              Calendário
            </button>
            <button
              className={view === "list" ? "selected" : ""}
              aria-pressed={view === "list"}
              onClick={() => {
                setView("list");
                setDay("");
              }}
            >
              <List size={17} />
              Lista
            </button>
          </div>
          <span className="agenda-window-label">
            {events.length}{" "}
            {events.length === 1 ? "evento aprovado" : "eventos aprovados"} ·
            próximos 3 meses
          </span>
        </div>
        {view === "calendar" && (
          <div className="agenda-month-tabs" aria-label="Meses da agenda">
            {Array.from({ length: 3 }, (_, i) => {
              const d = new Date(now[0], now[1] - 1 + i, 1);
              return (
                <button
                  key={i}
                  className={i === monthOffset ? "selected" : ""}
                  aria-pressed={i === monthOffset}
                  onClick={() => {
                    setMonthOffset(i);
                    setDay("");
                  }}
                >
                  {MONTHS[d.getMonth()]} <small>{d.getFullYear()}</small>
                </button>
              );
            })}
          </div>
        )}
        <div className="agenda-toolbar">
          <div className="month-selector">
            <h2>
              {view === "calendar" ? (
                <>
                  {MONTHS[month]} <span>{year}</span>
                </>
              ) : (
                "Agenda dos próximos três meses"
              )}
            </h2>
            {view === "calendar" && (
              <div>
                <IconButton
                  label="Mês anterior"
                  disabled={monthOffset === 0}
                  onClick={() => {
                    setMonthOffset((x) => x - 1);
                    setDay("");
                  }}
                >
                  <ChevronLeft size={18} />
                </IconButton>
                <IconButton
                  label="Próximo mês"
                  disabled={monthOffset === 2}
                  onClick={() => {
                    setMonthOffset((x) => x + 1);
                    setDay("");
                  }}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </div>
            )}
          </div>
          <div className="agenda-tools">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Buscar evento"
                placeholder="Buscar evento"
                maxLength={200}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="sector-filter">
              <span className="sr-only">Filtrar por setor / curso</span>
              <select
                aria-label="Filtrar por setor / curso"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
              >
                <option value="">Todos os setores / cursos</option>
                {metadata.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`button filter-button ${filters ? "selected" : ""}`}
              aria-expanded={filters}
              onClick={() => setFilters((x) => !x)}
            >
              <SlidersHorizontal size={16} />
              <span>Filtros</span>
              {(themeId || roomId) && <span className="tiny-dot" />}
            </button>
          </div>
        </div>
        {filters && (
          <div className="filter-row">
            <label className="field">
              Tema
              <select
                value={themeId}
                onChange={(e) => setThemeId(e.target.value)}
              >
                <option value="">Todos os temas</option>
                {metadata.themes.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Local
              <select
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              >
                <option value="">Todos os ambientes</option>
                {metadata.rooms.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-button"
              onClick={() => {
                setThemeId("");
                setRoomId("");
                setCourseId("");
                setSearch("");
                setDay("");
              }}
            >
              Limpar filtros
            </button>
          </div>
        )}
        {view === "calendar" && (
          <Calendar
            month={month}
            year={year}
            events={monthEvents}
            day={day}
            setDay={setDay}
          />
        )}
        <div className="list-section-heading">
          <h3>
            {day
              ? `Eventos de ${dateFormat(day)}`
              : view === "calendar"
                ? "Encontros deste mês"
                : "Todos os encontros"}
          </h3>
          {day ? (
            <button className="text-button" onClick={() => setDay("")}>
              Ver mês completo <X size={14} />
            </button>
          ) : (
            <span className="count-pill">{visible.length}</span>
          )}
        </div>
        {loading ? (
          <div className="loading-state">
            <LoaderCircle className="spin" size={19} />
            Atualizando eventos…
          </div>
        ) : visible.length ? (
          <div className="event-list">
            {visible.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="public-empty">
            <CalendarDays size={30} strokeWidth={1.2} />
            <h3>
              {hasFilters
                ? "Nenhum evento encontrado."
                : "Novos encontros vão aparecer por aqui."}
            </h3>
            <p>
              {hasFilters
                ? "Experimente outro período ou ajuste os filtros."
                : "Os eventos são publicados assim que a administração os aprova."}
            </p>
            {!hasFilters && (
              <button className="text-button" onClick={onRequest}>
                Propor um evento <ArrowRight size={15} />
              </button>
            )}
          </div>
        )}
        <div className="agenda-footnote">
          <ShieldCheck size={14} />
          <span>
            Somente eventos aprovados. Os horários seguem o fuso de Brasília.
          </span>
        </div>
      </section>
      <div className="notification-invite">
        <div>
          <Bell size={19} />
          <span>Quer receber as novidades da agenda?</span>
        </div>
        <button className="text-button" onClick={onNotifications}>
          Preferências de e-mail <ArrowRight size={15} />
        </button>
      </div>
    </>
  );
}
function Calendar({ month, year, events, day, setDay }) {
  const total = new Date(year, month + 1, 0).getDate(),
    start = new Date(year, month, 1).getDay(),
    padding = (7 - ((total + start) % 7)) % 7;
  return (
    <div
      className="calendar-grid"
      aria-label={`Calendário de ${MONTHS[month]} de ${year}`}
    >
      {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((d) => (
        <div className="calendar-weekday" key={d}>
          {d}
        </div>
      ))}
      {Array.from({ length: start }, (_, i) => (
        <div className="calendar-blank" key={"before" + i} />
      ))}
      {Array.from({ length: total }, (_, i) => {
        const d = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
          items = events.filter((e) => e.date === d);
        return (
          <button
            key={d}
            className={`calendar-day ${d === today() ? "today" : ""} ${day === d ? "chosen" : ""}`}
            onClick={() => setDay(day === d ? "" : d)}
            aria-label={`${i + 1} de ${MONTHS[month]}, ${items.length} eventos`}
            aria-pressed={day === d}
          >
            <span className="day-number">{i + 1}</span>
            {items.length > 0 && (
              <>
                <span className="calendar-events">
                  {items.slice(0, 2).map((e) => (
                    <span
                      className="calendar-event"
                      key={e.id}
                      title={`${e.startTime} · ${e.name}`}
                    >
                      <b>{e.startTime}</b> {e.name}
                    </span>
                  ))}
                  {items.length > 2 && (
                    <span className="calendar-more">
                      +{items.length - 2} encontros
                    </span>
                  )}
                </span>
                <small className="calendar-mobile-count">
                  {items.length}
                  <span className="sr-only"> eventos</span>
                </small>
              </>
            )}
          </button>
        );
      })}
      {Array.from({ length: padding }, (_, i) => (
        <div className="calendar-blank" key={"after" + i} />
      ))}
    </div>
  );
}

function EventRow({ event: e }) {
  return (
    <article className="event-row">
      <div className="event-date">
        <strong>{e.date?.slice(8)}</strong>
        <span>{dateFormat(e.date, { month: "short" }).replace(".", "")}</span>
      </div>
      <div className="event-info">
        <span className="event-theme">{e.themeName}</span>
        <h3>{e.name}</h3>
        <p>
          <UserRound size={13} />
          {e.speaker}
        </p>
      </div>
      <div className="event-meta">
        <span>
          <Clock3 size={15} />
          {e.startTime} – {e.endTime}
        </span>
        <span>
          <MapPin size={15} />
          {e.roomName}
        </span>
      </div>
      <span className="public-badge">
        <span className="tiny-dot" /> Confirmado
      </span>
    </article>
  );
}
function Spaces({ metadata, onRequest }) {
  return (
    <>
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">ESPAÇOS PARA CONECTAR</span>
          <h1>
            Um lugar para cada ideia<span className="green-text">.</span>
          </h1>
          <p>Conheça os ambientes disponíveis para solicitar seu evento.</p>
        </div>
      </div>
      {metadata.rooms.length ? (
        <div className="card-grid rooms-grid">
          {metadata.rooms.map((r, i) => (
            <article className="room-card" key={r.id}>
              <div className="room-visual">
                <Building2 size={55} strokeWidth={0.8} />
                <span>{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="room-content">
                <h2>{r.name}</h2>
                <p>
                  {r.description ||
                    "Espaço disponível para eventos acadêmicos."}
                </p>
                <button className="text-button" onClick={onRequest}>
                  Solicitar um evento <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel empty-state">
          <Building2 size={36} />
          <h3>Os espaços serão apresentados aqui.</h3>
          <p>
            A administração ainda está organizando os ambientes disponíveis.
          </p>
        </div>
      )}
    </>
  );
}
function MyRequests({ requests, onOpen, onNew }) {
  const [status, setStatus] = useState("all");
  const list = requests.filter((r) => status === "all" || r.status === status);
  return (
    <>
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">ÁREA DO SOLICITANTE</span>
          <h1>
            Minhas solicitações<span className="green-text">.</span>
          </h1>
          <p>Acompanhe o status dos eventos que você cadastrou.</p>
        </div>
        <button className="button primary" onClick={onNew}>
          <Plus size={17} /> Nova solicitação
        </button>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>Suas solicitações</h2>
          <label className="field inline-field">
            <span className="sr-only">Filtrar status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Todos os status</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        {list.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Data e horário</th>
                  <th>Local</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Ação</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name || "Solicitação sem título"}</strong>
                      <small>
                        {r.courseName || r.themeName || "Curso a definir"}
                      </small>
                    </td>
                    <td>
                      {dateFormat(r.date)}
                      <small>
                        {r.startTime
                          ? `${r.startTime} – ${r.endTime || "…"}`
                          : "Horário a definir"}
                      </small>
                    </td>
                    <td>
                      {r.roomName || "A definir"}
                      <small>Campus São Bento do Sul</small>
                    </td>
                    <td>
                      <span className={`badge ${r.status}`}>
                        {STATUS[r.status]}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button small"
                        onClick={() => onOpen(r)}
                      >
                        Abrir <ArrowUpRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={33} />
            <h3>
              {requests.length
                ? "Nenhuma solicitação neste status."
                : "Sua próxima ideia começa aqui."}
            </h3>
            <p>Você pode salvar um rascunho e terminar de preencher depois.</p>
            <button className="button primary" onClick={onNew}>
              <Plus size={16} /> Criar solicitação
            </button>
          </div>
        )}
      </section>
    </>
  );
}
function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState("login"),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState(null),
    [companyName, setCompanyName] = useState(""),
    [cnpj, setCnpj] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const emailRef = useRef(null),
    nameRef = useRef(null),
    firstRoleRef = useRef(null);
  const registering = mode === "register",
    choosingRole = registering && !role,
    requester = registering && role === "requester";
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = choosingRole
        ? firstRoleRef.current
        : requester
          ? nameRef.current
          : emailRef.current;
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, role]);
  const changeMode = (nextMode) => {
    setMode(nextMode);
    setRole(null);
    setError("");
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busy || choosingRole) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/auth/${mode}`, {
        method: "POST",
        body: registering
          ? {
              email,
              password,
              role,
              ...(requester ? { name, companyName, cnpj } : {}),
            }
          : { email, password },
      });
      await onSuccess(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        mode === "login"
          ? "Que bom ter você aqui."
          : "Faça parte dos próximos encontros."
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="auth-modal">
        <p className="modal-intro">
          {mode === "login"
            ? "Entre com seu e-mail para acessar sua área."
            : choosingRole
              ? "Primeiro, escolha como você quer usar a agenda."
              : "Preencha os dados do perfil escolhido para criar sua conta."}
        </p>
        <div className="tabs auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            aria-pressed={mode === "login"}
            disabled={busy}
            onClick={() => changeMode("login")}
          >
            Entrar
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            aria-pressed={mode === "register"}
            disabled={busy}
            onClick={() => changeMode("register")}
          >
            Criar conta
          </button>
        </div>
        {choosingRole ? (
          <fieldset className="auth-role-choice">
            <legend>Qual conta você quer criar?</legend>
            <button
              type="button"
              className="auth-role-option"
              ref={firstRoleRef}
              onClick={() => setRole("visitor")}
            >
              <UserRound size={25} aria-hidden="true" />
              <span>
                <strong>Visitante</strong>
                <small>Acompanhe os eventos. Apenas e-mail e senha.</small>
              </span>
              <ArrowRight size={19} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="auth-role-option"
              onClick={() => setRole("requester")}
            >
              <Building2 size={25} aria-hidden="true" />
              <span>
                <strong>Solicitante</strong>
                <small>
                  Proponha eventos. Informe também seu nome, empresa e CNPJ.
                </small>
              </span>
              <ArrowRight size={19} aria-hidden="true" />
            </button>
          </fieldset>
        ) : (
          <form
            onSubmit={submit}
            className="stack auth-fields"
            aria-busy={busy}
          >
            {registering && (
              <div className="auth-profile-summary">
                <span>
                  <strong>
                    {requester ? "Conta de solicitante" : "Conta de visitante"}
                  </strong>
                  <small>
                    {requester
                      ? "Para propor e acompanhar seus eventos."
                      : "Para acompanhar a agenda de eventos."}
                  </small>
                </span>
                <button
                  type="button"
                  className="auth-switch-role"
                  disabled={busy}
                  onClick={() => {
                    setRole(null);
                    setError("");
                  }}
                >
                  Mudar perfil
                </button>
              </div>
            )}
            {requester && (
              <label className="field">
                Nome completo
                <input
                  ref={nameRef}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={busy}
                  maxLength={160}
                />
              </label>
            )}
            <label className="field">
              E-mail
              <input
                ref={emailRef}
                type="email"
                autoComplete="email"
                placeholder="voce@exemplo.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={busy}
                maxLength={254}
              />
            </label>
            <label className="field">
              Senha
              <input
                type="password"
                minLength={mode === "register" ? 12 : 1}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                placeholder={
                  mode === "register" ? "Pelo menos 12 caracteres" : "Sua senha"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
                maxLength={128}
              />
            </label>
            {requester && (
              <>
                <label className="field">
                  Nome da empresa
                  <input
                    autoComplete="organization"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    disabled={busy}
                    maxLength={200}
                  />
                </label>
                <label className="field">
                  CNPJ da empresa
                  <input
                    type="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-describedby="auth-cnpj-help"
                    value={cnpj}
                    onChange={(e) => setCnpj(e.target.value.toUpperCase())}
                    required
                    disabled={busy}
                    maxLength={18}
                  />
                  <small id="auth-cnpj-help" className="field-hint">
                    Informe o CNPJ com ou sem pontuação.
                  </small>
                </label>
              </>
            )}
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : null}
              {busy
                ? "Aguarde…"
                : mode === "login"
                  ? "Entrar na minha conta"
                  : "Criar minha conta"}
              {!busy && <ArrowRight size={17} />}
            </button>
            <p className="form-help">
              <LockKeyhole size={13} /> Seu acesso é protegido. As permissões
              são definidas pela sua conta.
            </p>
          </form>
        )}
      </div>
    </Modal>
  );
}
function PasswordModal({ user, onClose, notify, onLogout }) {
  const [currentPassword, setCurrent] = useState(""),
    [newPassword, setNew] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title="Minha conta"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="modal-intro">
        {user?.name}
        <br />
        {user?.email}
      </p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (newPassword !== confirm) {
            setError("As novas senhas precisam ser iguais.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await api("/auth/password", {
              method: "POST",
              body: { currentPassword, newPassword },
            });
            notify("Senha alterada com sucesso.");
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Alterar senha</h3>
        <label className="field">
          Senha atual
          <input
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          Nova senha
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
        </label>
        <label className="field">
          Confirmar nova senha
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
      <button
        className="text-button danger-text account-logout"
        type="button"
        onClick={onLogout}
        disabled={busy}
      >
        <LogOut size={16} /> Sair da minha conta
      </button>
    </Modal>
  );
}
function RequestModal({
  request: initialRequest,
  metadata,
  user,
  onClose,
  onSaved,
  notify,
}) {
  const [request, setRequest] = useState(initialRequest);
  const [data, setData] = useState(() =>
      request
        ? { ...blank(), ...request, resourceIds: request.resourceIds || [] }
        : { ...blank(), requesterName: user?.name || "" },
    ),
    [editApproved, setEditApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fields, setFields] = useState({}),
    [action, setAction] = useState(""),
    [reason, setReason] = useState("");
  const isAdmin = user?.role === "admin",
    owned = !request || request.authorId === user?.id,
    editable =
      !request ||
      (owned && ["draft", "pending", "rejected"].includes(request.status)) ||
      (isAdmin && request.status === "approved" && editApproved);
  const course = metadata.courses.find((c) => c.id === data.courseId),
    room = metadata.rooms.find((r) => r.id === data.roomId);
  const availableResources = metadata.resources.filter((r) =>
    room?.resourceIds?.includes(r.id),
  );
  const unsavedChanges =
    request &&
    Object.entries(blank()).some(
      ([key, fallback]) =>
        JSON.stringify(data[key] ?? fallback) !==
        JSON.stringify(request[key] ?? fallback),
    );
  const update = (key, value) => {
    setData((d) => ({
      ...d,
      [key]: value,
      ...(key === "roomId" ? { resourceIds: [] } : {}),
    }));
    setFields((f) => ({ ...f, [key]: undefined }));
  };
  const field = (name, label, type = "text", options = null, extra = {}) => (
    <label className={`field ${fields[name] ? "invalid" : ""}`}>
      {label}
      {options ? (
        <select
          value={data[name] || ""}
          disabled={!editable}
          onChange={(e) => update(name, e.target.value)}
          aria-invalid={!!fields[name]}
        >
          <option value="">Selecione…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          value={data[name] || ""}
          disabled={!editable}
          onChange={(e) => update(name, e.target.value)}
          maxLength={5000}
          rows={3}
          aria-invalid={!!fields[name]}
        />
      ) : (
        <input
          type={type}
          value={data[name] || ""}
          disabled={!editable}
          onChange={(e) => update(name, e.target.value)}
          maxLength={name === "name" ? 200 : 500}
          aria-invalid={!!fields[name]}
          {...extra}
        />
      )}
      {fields[name] && <small className="field-error">{fields[name]}</small>}
    </label>
  );
  const execute = async (fn) => {
    setBusy(true);
    setError("");
    setFields({});
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setError(e.message);
      setFields(e.code === "EARLIER_REQUEST" ? {} : e.fields || {});
    } finally {
      setBusy(false);
    }
  };
  const save = async (submit) =>
    execute(async () => {
      let r = await api(request ? `/requests/${request.id}` : "/requests", {
        method: request ? "PUT" : "POST",
        body: { ...data, ...(request ? { version: request.version } : {}) },
      });
      setRequest(r.request);
      if (submit)
        r = await api(`/requests/${r.request.id}/submit`, {
          method: "POST",
          body: { version: r.request.version },
        });
      notify(
        submit
          ? "Solicitação enviada para análise."
          : "Solicitação salva com sucesso.",
      );
    });
  const act = async (type) =>
    execute(async () => {
      let path =
        type === "approve" || type === "reject"
          ? `/admin/requests/${request.id}/${type}`
          : `/requests/${request.id}/${type}`;
      if (type === "delete") path = `/requests/${request.id}`;
      await api(path, {
        method: type === "delete" ? "DELETE" : "POST",
        body: {
          version: request.version,
          ...(type === "reject" ? { reason } : {}),
        },
      });
      notify(
        type === "approve"
          ? "Evento aprovado e publicado na agenda."
          : type === "reject"
            ? "Solicitação rejeitada com justificativa."
            : type === "delete"
              ? "Rascunho excluído."
              : "Evento cancelado.",
      );
    });
  return (
    <Modal
      wide
      title={
        request
          ? request.name || "Solicitação sem título"
          : "Uma nova ideia na agenda."
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="request-modal-top">
        <p className="modal-intro">
          {request
            ? "Confira os dados e acompanhe o andamento da solicitação."
            : "Preencha os dados do encontro. Você pode salvar e continuar depois."}
        </p>
        {request && (
          <span className={`badge ${request.status}`}>
            {STATUS[request.status]}
          </span>
        )}
      </div>
      {request?.rejectionReason && (
        <div className="rejection-note">
          <Info size={18} />
          <div>
            <strong>Justificativa da rejeição</strong>
            <p>{request.rejectionReason}</p>
          </div>
        </div>
      )}
      {request && (
        <p className="author-note">
          Criado por {request.authorName || "usuário autenticado"}
          {request.id && (
            <> · Protocolo {request.id.slice(0, 8).toUpperCase()}</>
          )}
        </p>
      )}
      {!request &&
        (!metadata.themes.length ||
          !metadata.rooms.length ||
          !metadata.courses.length) && (
          <div className="notice">
            Os cadastros de temas, ambientes e cursos precisam ser preenchidos
            pela administração antes do envio. Você já pode salvar sua ideia
            como rascunho.
          </div>
        )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
      >
        <fieldset disabled={busy} className="request-form">
          <div className="form-section-heading">
            <span>01</span>
            <div>
              <h3>O encontro</h3>
              <p>O que, onde e quando vai acontecer.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="span-2">{field("name", "Nome do evento *")}</div>
            {field("themeId", "Tema *", "text", metadata.themes)}
            {field("date", "Data *", "date", null, { min: today() })}
            {field("startTime", "Horário de início *", "time")}
            {field("endTime", "Horário de término *", "time")}
            {field("roomId", "Ambiente *", "text", metadata.rooms)}
            {field("speaker", "Palestrante *")}
            {field(
              "courseId",
              "Curso / coordenação *",
              "text",
              metadata.courses,
            )}
            <label className="field">
              Centro de custo
              <input
                value={
                  course?.costCenterName ||
                  metadata.costCenters.find(
                    (c) => c.id === course?.costCenterId,
                  )?.name ||
                  data.costCenterName ||
                  ""
                }
                placeholder="Preenchido pelo curso"
                readOnly
                disabled
              />
            </label>
          </div>
          <div className="form-section-heading">
            <span>02</span>
            <div>
              <h3>Pessoas e propósito</h3>
              <p>Informe quem realiza o encontro e para quem ele é voltado.</p>
            </div>
          </div>
          <div className="form-grid">
            {field("requesterName", "Solicitante / responsável *")}
            {field("audience", "Público-alvo *")}
            <div className="span-2">
              {field("organizer", "Realização / entidade organizadora *")}
            </div>
            {field(
              "audienceCourseId",
              "Curso do público (opcional)",
              "text",
              metadata.courses,
            )}
            {field(
              "audienceSemester",
              "Semestre do público (opcional)",
              "text",
              Array.from({ length: 12 }, (_, i) => ({
                id: String(i + 1),
                name: `${i + 1}º semestre`,
              })),
            )}
            <div className="span-2">
              {field("objective", "Objetivo do evento *", "textarea")}
            </div>
            <div className="span-2">
              {field("justification", "Justificativa *", "textarea")}
            </div>
          </div>
          <div className="form-section-heading">
            <span>03</span>
            <div>
              <h3>O que precisamos preparar?</h3>
              <p>Informações para apoiar a organização do evento.</p>
            </div>
          </div>
          <div className="boolean-grid">
            {[
              ["ceremony", "Haverá cerimonial?"],
              ["registration", "Haverá inscrições?"],
              ["certificates", "Precisará de declarações?"],
            ].map(([key, label]) => (
              <fieldset
                className={`boolean-field ${fields[key] ? "invalid" : ""}`}
                key={key}
                disabled={!editable}
              >
                <legend>{label} *</legend>
                <div>
                  {[
                    [true, "Sim"],
                    [false, "Não"],
                  ].map(([v, t]) => (
                    <label
                      key={t}
                      className={data[key] === v ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name={key}
                        checked={data[key] === v}
                        onChange={() => update(key, v)}
                      />
                      {t}
                    </label>
                  ))}
                </div>
                {fields[key] && (
                  <small className="field-error">{fields[key]}</small>
                )}
              </fieldset>
            ))}
          </div>
          <p className="form-help">
            Inscrições e declarações são informações de planejamento. A agenda
            não gerencia participantes nem emite documentos.
          </p>
          <div className="field resource-field">
            <span>
              Recursos necessários <span className="optional">opcional</span>
            </span>
            {data.roomId ? (
              <div className="checkbox-grid">
                {availableResources.length ? (
                  availableResources.map((r) => (
                    <label className="checkbox-option" key={r.id}>
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={data.resourceIds.includes(r.id)}
                        onChange={(e) =>
                          update(
                            "resourceIds",
                            e.target.checked
                              ? [...data.resourceIds, r.id]
                              : data.resourceIds.filter((id) => id !== r.id),
                          )
                        }
                      />
                      {r.name}
                    </label>
                  ))
                ) : (
                  <p className="muted">
                    Nenhum recurso associado a este ambiente.
                  </p>
                )}
              </div>
            ) : (
              <p className="muted">
                Selecione um ambiente para consultar os recursos disponíveis.
              </p>
            )}
            {fields.resourceIds && (
              <small className="field-error">{fields.resourceIds}</small>
            )}
          </div>
          {field("notes", "Observações (opcional)", "textarea")}
          <p className="form-help">
            * Obrigatório para enviar. Rascunhos podem estar incompletos.
            Alterações de data, horário ou ambiente de um pedido pendente
            reiniciam sua prioridade na fila.
          </p>
        </fieldset>
        {error && (
          <div className="inline-error" role="alert">
            {error}
            {Object.keys(fields).length > 0 && (
              <p>Revise os campos destacados antes de continuar.</p>
            )}
          </div>
        )}
        {action && (
          <div className="action-confirm">
            <h3>
              {action === "reject"
                ? "Justifique a rejeição"
                : action === "delete"
                  ? "Excluir este rascunho?"
                  : "Cancelar este evento?"}
            </h3>
            {action === "reject" ? (
              <label className="field">
                Motivo da rejeição
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={3}
                  maxLength={2000}
                  rows={3}
                />
              </label>
            ) : (
              <p>
                {action === "delete"
                  ? "O rascunho será excluído permanentemente."
                  : "A solicitação será mantida no histórico e não aparecerá na agenda pública."}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button"
                onClick={() => setAction("")}
              >
                Voltar
              </button>
              <button
                type="button"
                className="button danger"
                disabled={busy || (action === "reject" && !reason.trim())}
                onClick={() => act(action)}
              >
                {busy ? "Aguarde…" : "Confirmar"}
              </button>
            </div>
          </div>
        )}
        <div className="form-actions request-actions">
          {owned && request?.status === "draft" && (
            <button
              type="button"
              className="text-button danger-text"
              disabled={busy}
              onClick={() => setAction("delete")}
            >
              <Trash2 size={15} /> Excluir rascunho
            </button>
          )}
          {((owned && request?.status === "pending") ||
            (isAdmin && request?.status === "approved")) && (
            <button
              type="button"
              className="text-button danger-text"
              disabled={busy}
              onClick={() => setAction("cancel")}
            >
              <Ban size={15} /> Cancelar evento
            </button>
          )}
          <span className="spacer" />
          {isAdmin && request?.status === "pending" && (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setAction("reject")}
              >
                Rejeitar
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || unsavedChanges}
                title={
                  unsavedChanges
                    ? "Salve as alterações antes de aprovar."
                    : undefined
                }
                onClick={() => act("approve")}
              >
                <Check size={16} /> Aprovar e publicar
              </button>
            </>
          )}
          {isAdmin && request?.status === "approved" && !editApproved && (
            <button
              type="button"
              className="button"
              onClick={() => setEditApproved(true)}
            >
              <Pencil size={16} /> Editar evento
            </button>
          )}
          {editable && (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => save(false)}
              >
                <Save size={16} />
                {request && request.status !== "draft"
                  ? "Salvar alterações"
                  : "Salvar rascunho"}
              </button>
              {(!request || ["draft", "rejected"].includes(request.status)) && (
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy}
                >
                  <Send size={16} />
                  {busy
                    ? "Enviando…"
                    : request?.status === "rejected"
                      ? "Corrigir e reenviar"
                      : "Enviar para análise"}
                </button>
              )}
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
function readEmailAction() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  for (const [key, kind] of [
    ["email-verify", "verify"],
    ["email-unsubscribe", "unsubscribe"],
  ]) {
    const token = fragment.get(key);
    if (token && token.length <= 512) return { kind, token };
  }
  return null;
}
function NotificationModal({ metadata, onClose, notify }) {
  const [state, setState] = useState(null),
    [preferences, setPreferences] = useState({
      publications: false,
      reminders: false,
      courseId: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("/notifications/preferences")
      .then((data) => {
        if (active) {
          setState(data);
          setPreferences({
            ...data.preferences,
            courseId: data.preferences.courseId || "",
          });
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/notifications/preferences", {
        method: "PUT",
        body: preferences,
      });
      setState(data);
      setPreferences({
        ...data.preferences,
        courseId: data.preferences.courseId || "",
      });
      notify(
        data.verified && data.available
          ? "Preferências de e-mail atualizadas."
          : "Preferências salvas. O envio depende da confirmação do e-mail e do serviço disponível.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/notifications/verify-request", {
        method: "POST",
        body: {},
      });
      setState(data);
      notify(
        data.message || "Pedido de confirmação registrado. Confira seu e-mail.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Seus avisos da agenda"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="modal-intro">
        Escolha os avisos que você quer receber. Sua conta continua funcionando
        mesmo com os avisos desativados.
      </p>
      {!state && !error ? (
        <div className="loading-state">
          <LoaderCircle size={21} className="spin" />
          Carregando preferências…
        </div>
      ) : (
        state && (
          <form className="stack" onSubmit={save}>
            <div
              className={`email-status ${state.available ? "" : "unavailable"}`}
            >
              <Mail size={20} />
              <div>
                <strong>{state.email}</strong>
                <p>
                  {!state.available
                    ? "O serviço de e-mail ainda não foi configurado. Você pode salvar suas preferências; nenhum envio ocorrerá por enquanto."
                    : state.verified
                      ? "Endereço confirmado para receber avisos."
                      : "Confirme este endereço para ativar os avisos."}
                </p>
              </div>
            </div>
            <label className="checkbox-option notification-option">
              <input
                type="checkbox"
                checked={!!preferences.publications}
                disabled={busy}
                onChange={(e) =>
                  setPreferences((p) => ({
                    ...p,
                    publications: e.target.checked,
                  }))
                }
              />
              <span>
                <strong>Novos eventos aprovados</strong>
                <small>Receba os encontros publicados na agenda.</small>
              </span>
            </label>
            <label className="checkbox-option notification-option">
              <input
                type="checkbox"
                checked={!!preferences.reminders}
                disabled={busy}
                onChange={(e) =>
                  setPreferences((p) => ({ ...p, reminders: e.target.checked }))
                }
              />
              <span>
                <strong>Lembretes no dia do evento</strong>
                <small>
                  Um aviso com data, horário e local antes do início.
                </small>
              </span>
            </label>
            <label className="field">
              Setor / curso de interesse
              <select
                value={preferences.courseId || ""}
                disabled={busy}
                onChange={(e) =>
                  setPreferences((p) => ({ ...p, courseId: e.target.value }))
                }
              >
                <option value="">Todos os setores / cursos</option>
                {metadata.courses.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="form-help">
              A confirmação do agendamento de uma solicitação sua acompanha a
              preferência de novos eventos. Você pode desativar todos os avisos
              a qualquer momento.
            </p>
            {state.available && !state.verified && (
              <button
                className="button"
                type="button"
                onClick={verify}
                disabled={busy}
              >
                <Mail size={16} />
                Enviar confirmação de e-mail
              </button>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button"
                onClick={onClose}
                disabled={busy}
              >
                Fechar
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar preferências"}
              </button>
            </div>
          </form>
        )
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
function EmailActionModal({ action, onClose, notify }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const verify = action.kind === "verify";
  return (
    <Modal
      title={verify ? "Confirmar seu e-mail" : "Desativar avisos por e-mail"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="modal-intro">
        {verify
          ? "Confirme que você quer usar este endereço para receber os avisos da agenda. Suas preferências continuam sob seu controle."
          : "Você pode desativar todos os avisos deste endereço. Isso não altera sua conta nem suas solicitações."}
      </p>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button className="button" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button
          className={`button ${verify ? "primary" : "danger"}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const data = await api(`/notifications/${action.kind}`, {
                method: "POST",
                body: { token: action.token },
              });
              notify(
                data.message ||
                  (verify ? "E-mail confirmado." : "Avisos desativados."),
              );
              onClose();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Aguarde…" : verify ? "Confirmar e-mail" : "Desativar avisos"}
        </button>
      </div>
    </Modal>
  );
}

createRoot(document.getElementById("root")).render(<App />);
