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
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <strong>
          univille<span className="brand-dot">.</span>
        </strong>
        <small>AGENDA DE EVENTOS</small>
      </div>
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
      <aside className="sidebar">
        <button
          className="brand-button"
          onClick={() => navigate("agenda")}
          aria-label="Página inicial"
        >
          <Brand />
        </button>
        <div className="nav-label">EXPLORAR</div>
        <nav aria-label="Navegação principal">
          <button
            className={page === "agenda" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("agenda")}
          >
            <CalendarDays size={20} />
            <span>Agenda de eventos</span>
            {page === "agenda" && <span className="nav-dot" />}
          </button>
          <button
            className={page === "spaces" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("spaces")}
          >
            <Building2 size={20} />
            <span>Espaços</span>
          </button>
          {requester && (
            <>
              <div className="nav-label nav-label-spaced">MINHA ÁREA</div>
              <button
                className={page === "requests" ? "nav-item active" : "nav-item"}
                onClick={() => navigate("requests")}
              >
                <FileText size={20} />
                <span>Minhas solicitações</span>
              </button>
            </>
          )}
          {user?.role === "admin" && (
            <button
              className={page === "admin" ? "nav-item active" : "nav-item"}
              onClick={() => navigate("admin")}
            >
              <ShieldCheck size={20} />
              <span>Administração</span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="tiny-dot" /> Encontros que conectam.
            <p>
              Um espaço para compartilhar
              <br />
              conhecimento e novas ideias.
            </p>
          </div>
          {user ? (
            <div className="profile">
              <button
                className="profile-main"
                onClick={() => setModal("password")}
                title="Alterar senha"
              >
                <span className="avatar">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{user.name}</strong>
                  <small>
                    {user.role === "admin"
                      ? "Administrador"
                      : user.role === "requester"
                        ? "Solicitante"
                        : "Visitante"}
                  </small>
                </span>
              </button>
              <IconButton label="Sair" onClick={logout}>
                <LogOut size={18} />
              </IconButton>
            </div>
          ) : (
            <div className="visitor">
              <span className="avatar">
                <UserRound size={18} />
              </span>
              <span>
                <strong>Acesso público</strong>
                <small>Você está como visitante</small>
              </span>
            </div>
          )}
        </div>
      </aside>
      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Universidade</span>
            <ChevronRight size={13} />
            <strong>
              {page === "agenda"
                ? "Agenda de eventos"
                : page === "spaces"
                  ? "Espaços"
                  : page === "admin"
                    ? "Administração"
                    : "Minhas solicitações"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="campus">
              <span className="tiny-dot" /> Joinville · SC
            </span>
            <span className="topbar-divider" />
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
            {!user ? (
              <button
                className="button button-login"
                onClick={() => setModal("login")}
              >
                Entrar <ArrowUpRight size={16} />
              </button>
            ) : (
              <button
                className="button button-login"
                onClick={() => setModal("password")}
              >
                <UserRound size={16} />
                <span>Minha conta</span>
              </button>
            )}
          </div>
        </header>
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
            <span>Conhecimento que reúne.</span>
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
function Agenda({ events, metadata, onRequest, loading }) {
  const now = today().split("-").map(Number),
    [monthOffset, setMonthOffset] = useState(0),
    [view, setView] = useState("list"),
    [search, setSearch] = useState(""),
    [themeId, setThemeId] = useState(""),
    [roomId, setRoomId] = useState(""),
    [filters, setFilters] = useState(false),
    [day, setDay] = useState("");
  const date = new Date(now[0], now[1] - 1 + monthOffset, 1),
    month = date.getMonth(),
    year = date.getFullYear(),
    prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const filtered = events.filter(
    (e) =>
      e.date?.startsWith(prefix) &&
      (!day || e.date === day) &&
      (!themeId || e.themeId === themeId) &&
      (!roomId || e.roomId === roomId) &&
      (!search ||
        [e.name, e.speaker, e.themeName, e.roomName]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())),
  );
  const totalMonth = events.filter((e) => e.date?.startsWith(prefix)).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            <span className="tiny-dot" /> CAMPUS EM MOVIMENTO
          </span>
          <h1>
            Boas ideias merecem
            <br />
            um lugar na agenda<span className="green-text">.</span>
          </h1>
          <p>Explore os próximos encontros da nossa comunidade.</p>
        </div>
        <button className="button primary hero-button" onClick={onRequest}>
          Solicitar um evento <ArrowUpRight size={18} />
        </button>
      </div>
      <section className="overview" aria-label="Resumo da agenda">
        <div className="month-feature">
          <div className="feature-top">
            <span>AGENDA ABERTA</span>
            <CalendarRange size={25} strokeWidth={1.3} />
          </div>
          <div className="feature-bottom">
            <h2>
              {MONTHS[month]}
              <span>{year}</span>
            </h2>
            <span className="feature-number">
              {String(totalMonth).padStart(2, "0")}
              <small>
                {totalMonth === 1 ? "evento aprovado" : "eventos aprovados"}
              </small>
            </span>
          </div>
          <div className="feature-orbit" aria-hidden="true" />
        </div>
        <div className="overview-note">
          <span className="overview-icon">
            <Users size={23} strokeWidth={1.4} />
          </span>
          <h3>
            Encontros para
            <br />
            ir além da sala de aula.
          </h3>
          <p>
            Palestras, conversas e experiências
            <br />
            que aproximam pessoas e ideias.
          </p>
          <div className="overview-note-footer">
            <span>Faça parte do próximo encontro</span>
            <ArrowUpRight size={19} />
          </div>
        </div>
        <div className="overview-window">
          <div className="small-label">NO HORIZONTE</div>
          <div className="window-months">
            {Array.from({ length: 3 }, (_, i) => {
              const dt = new Date(now[0], now[1] - 1 + i, 1);
              return (
                <button
                  key={i}
                  className={
                    monthOffset === i ? "window-month selected" : "window-month"
                  }
                  onClick={() => {
                    setMonthOffset(i);
                    setDay("");
                  }}
                >
                  <span>
                    {dt
                      .toLocaleDateString("pt-BR", { month: "short" })
                      .replace(".", "")}
                  </span>
                  <span className="window-count">
                    {
                      events.filter((e) =>
                        e.date?.startsWith(
                          `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`,
                        ),
                      ).length
                    }
                  </span>
                </button>
              );
            })}
          </div>
          <p>
            Eventos aprovados deste mês
            <br />e dos próximos dois meses.
          </p>
        </div>
      </section>
      <section className="agenda-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">DESCUBRA E PARTICIPE</span>
            <h2>
              Próximos eventos{" "}
              <span className="count-pill">{filtered.length}</span>
            </h2>
          </div>
          <div className="view-switch" aria-label="Visualização da agenda">
            <button
              className={view === "list" ? "selected" : ""}
              aria-label="Visualização em lista"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List size={17} /> Lista
            </button>
            <button
              className={view === "calendar" ? "selected" : ""}
              aria-label="Visualização em calendário"
              aria-pressed={view === "calendar"}
              onClick={() => setView("calendar")}
            >
              <CalendarDays size={16} /> Calendário
            </button>
          </div>
        </div>
        <div className="agenda-toolbar">
          <div className="month-selector">
            <h3>
              {MONTHS[month]} <span>{year}</span>
            </h3>
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
          </div>
          <div className="agenda-tools">
            <label className="search-field">
              <Search size={16} />
              <input
                placeholder="Buscar evento"
                aria-label="Buscar evento"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button
              className={`button filter-button ${filters ? "selected" : ""}`}
              onClick={() => setFilters((x) => !x)}
              aria-expanded={filters}
            >
              <SlidersHorizontal size={16} /> Filtros{" "}
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
                  <option key={t.id} value={t.id}>
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
                <option value="">Todos os espaços</option>
                {metadata.rooms.map((t) => (
                  <option key={t.id} value={t.id}>
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
            events={events.filter((e) => e.date?.startsWith(prefix))}
            day={day}
            setDay={setDay}
          />
        )}
        {day && (
          <div className="active-day">
            Eventos de {dateFormat(day)}
            <button className="text-button" onClick={() => setDay("")}>
              Ver mês completo <X size={13} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading-state">Atualizando eventos…</div>
        ) : filtered.length ? (
          <div className="event-list">
            {filtered.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="public-empty">
            <div className="empty-calendar">
              <CalendarDays size={28} strokeWidth={1.4} />
              <span className="empty-calendar-dot" />
            </div>
            <h3>
              {search || themeId || roomId || day
                ? "Nenhum evento encontrado"
                : "A agenda está pronta para novos encontros."}
            </h3>
            <p>
              {search || themeId || roomId || day
                ? "Experimente outros filtros para encontrar um evento."
                : "Assim que um evento for aprovado, ele aparecerá aqui."}
            </p>
            {!(search || themeId || roomId || day) && (
              <button className="text-button" onClick={onRequest}>
                Que tal começar uma ideia? <ArrowRight size={15} />
              </button>
            )}
          </div>
        )}
        <div className="agenda-footnote">
          <ShieldCheck size={14} />
          <span>Somente eventos aprovados são publicados nesta agenda.</span>
        </div>
      </section>
      <section className="bottom-cta">
        <div className="cta-symbol">
          <CalendarDays size={25} strokeWidth={1.4} />
        </div>
        <div>
          <h3>Tem um encontro em mente?</h3>
          <p>Envie sua solicitação e acompanhe cada etapa em um só lugar.</p>
        </div>
        <button className="button" onClick={onRequest}>
          Começar uma solicitação <ArrowUpRight size={17} />
        </button>
      </section>
    </>
  );
}
function Calendar({ month, year, events, day, setDay }) {
  const total = new Date(year, month + 1, 0).getDate(),
    start = new Date(year, month, 1).getDay();
  return (
    <div className="calendar-grid" aria-label="Calendário de eventos">
      {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((d) => (
        <div className="calendar-weekday" key={d}>
          {d}
        </div>
      ))}
      {Array.from({ length: start }, (_, i) => (
        <div className="calendar-blank" key={"blank" + i} />
      ))}
      {Array.from({ length: total }, (_, i) => {
        const d = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
          n = events.filter((e) => e.date === d).length;
        return (
          <button
            key={d}
            className={`calendar-day ${d === today() ? "today" : ""} ${day === d ? "chosen" : ""}`}
            onClick={() => setDay(day === d ? "" : d)}
            aria-label={`${i + 1}, ${n} eventos`}
          >
            <span>{i + 1}</span>
            {n > 0 && (
              <small>
                {n} {n === 1 ? "evento" : "eventos"}
              </small>
            )}
          </button>
        );
      })}
    </div>
  );
}
function EventRow({ event: e }) {
  return (
    <article className="event-row">
      <div className="event-date">
        <strong>{e.date?.slice(8)}</strong>
        <span>{dateFormat(e.date, { weekday: "short" }).replace(".", "")}</span>
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
          <span className="eyebrow">DA IDEIA AO ENCONTRO</span>
          <h1>
            Minhas solicitações<span className="green-text">.</span>
          </h1>
          <p>
            Acompanhe seus eventos, retome rascunhos e organize o próximo
            encontro.
          </p>
        </div>
        <button className="button primary" onClick={onNew}>
          <Plus size={17} /> Nova solicitação
        </button>
      </div>
      <div className="request-stats">
        {["draft", "pending", "approved"].map((s) => (
          <button
            className={status === s ? "request-stat selected" : "request-stat"}
            key={s}
            onClick={() => setStatus(status === s ? "all" : s)}
          >
            <span>{STATUS[s]}</span>
            <strong>{requests.filter((r) => r.status === s).length}</strong>
            {s === "approved" ? (
              <CheckCircle2 size={21} />
            ) : s === "pending" ? (
              <Clock3 size={21} />
            ) : (
              <FileText size={21} />
            )}
          </button>
        ))}
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
                      <small>{r.themeName || "Tema a definir"}</small>
                    </td>
                    <td>
                      {dateFormat(r.date)}
                      <small>
                        {r.startTime
                          ? `${r.startTime} – ${r.endTime || "…"}`
                          : "Horário a definir"}
                      </small>
                    </td>
                    <td>{r.roomName || "A definir"}</td>
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
    [role, setRole] = useState("requester"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(`/auth/${mode}`, {
        method: "POST",
        body: { name, email, password, role },
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
      <p className="modal-intro">
        {mode === "login"
          ? "Entre com seu e-mail para acessar sua área."
          : "Crie sua conta para acompanhar a agenda ou solicitar eventos."}
      </p>
      <div className="tabs auth-tabs">
        <button
          className={mode === "login" ? "active" : ""}
          onClick={() => {
            setMode("login");
            setError("");
          }}
        >
          Entrar
        </button>
        <button
          className={mode === "register" ? "active" : ""}
          onClick={() => {
            setMode("register");
            setError("");
          }}
        >
          Criar conta
        </button>
      </div>
      <form onSubmit={submit} className="stack">
        {mode === "register" && (
          <label className="field">
            Nome completo
            <input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </label>
        )}
        <label className="field">
          E-mail
          <input
            type="email"
            autoComplete="email"
            placeholder="voce@exemplo.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
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
            maxLength={128}
          />
        </label>
        {mode === "register" && (
          <fieldset className="role-choice">
            <legend>Como você quer usar a agenda?</legend>
            <label className={role === "requester" ? "selected" : ""}>
              <input
                type="radio"
                name="role"
                checked={role === "requester"}
                onChange={() => setRole("requester")}
              />
              <span>
                <strong>Solicitante</strong>
                <small>Quero propor e acompanhar eventos.</small>
              </span>
            </label>
            <label className={role === "visitor" ? "selected" : ""}>
              <input
                type="radio"
                name="role"
                checked={role === "visitor"}
                onChange={() => setRole("visitor")}
              />
              <span>
                <strong>Visitante</strong>
                <small>Quero consultar os próximos encontros.</small>
              </span>
            </label>
          </fieldset>
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
          <LockKeyhole size={13} /> Seu acesso é protegido. As permissões são
          definidas pela sua conta.
        </p>
      </form>
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
      setFields(e.fields || {});
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
              <p>Conte um pouco sobre a proposta.</p>
            </div>
          </div>
          <div className="form-grid">
            {field("requesterName", "Solicitante / responsável *")}
            {field("audience", "Público-alvo *")}
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
createRoot(document.getElementById("root")).render(<App />);
