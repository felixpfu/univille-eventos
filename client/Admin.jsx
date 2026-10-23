import React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ClipboardList,
  Edit3,
  Layers3,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";

const STATUS = {
  draft: "Rascunho",
  pending: "Aguardando aprovação",
  rejected: "Rejeitado",
  approved: "Aprovado",
  cancelled: "Cancelado",
};
const ROLES = {
  visitor: "Visitante",
  requester: "Solicitante",
  admin: "Administrador",
};
const CATALOGS = {
  themes: { label: "Temas", singular: "tema" },
  rooms: { label: "Ambientes", singular: "ambiente" },
  resources: { label: "Recursos", singular: "recurso" },
  courses: { label: "Cursos e coordenações", singular: "curso / coordenação" },
  costCenters: { label: "Centros de custo", singular: "centro de custo" },
};
const dateLabel = (value) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeZone: "UTC",
      }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
    : "Não informada";
const times = (row) =>
  row.startTime && row.endTime
    ? `${row.startTime} – ${row.endTime}`
    : row.startTime || "—";
const sameId = (a, b) => String(a) === String(b);
const semesterLabel = (value) =>
  /^\d+$/.test(String(value || "")) ? `${value}º semestre` : value || "";
const submittedLabel = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "Não enviada";

function todaySaoPaulo() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function weekRange(value) {
  const date = new Date(`${value || todaySaoPaulo()}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return weekRange(todaySaoPaulo());
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  const from = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { from, to: date.toISOString().slice(0, 10) };
}

function ErrorMessage({ message }) {
  return message ? (
    <p className="inline-error" role="alert">
      {message}
    </p>
  ) : null;
}

function Loading({ children = "Carregando…" }) {
  return (
    <div className="empty-state" role="status">
      <RefreshCw size={22} />
      <p>{children}</p>
    </div>
  );
}

function Modal({ title, children, onClose, busy = false }) {
  const titleId = useId();
  const dialog = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = dialog.current;
    element?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape" && !busyRef.current) closeRef.current();
      if (event.key !== "Tab" || !element) return;
      const focusable = [
        ...element.querySelectorAll(
          'button, input, select, textarea, a[href], [tabindex="0"]',
        ),
      ].filter((node) => !node.disabled && !node.hidden);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === element)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialog}
      >
        <div className="section-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="button icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar janela"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Requests({ api, metadata, onOpenRequest, refreshKey, onRefresh }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api("/admin/requests")
      .then((data) => {
        if (current) setRequests(data.requests);
      })
      .catch((err) => {
        if (current) setError(err.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, metadata, refreshKey]);
  const visible = useMemo(
    () =>
      requests.filter(
        (row) =>
          (!status || row.status === status) &&
          (!search ||
            [row.name, row.roomName, row.courseName, row.requesterName]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase("pt-BR")
              .includes(search.toLocaleLowerCase("pt-BR"))),
      ),
    [requests, status, search],
  );
  const pendingCount = requests.filter(
    (row) => row.status === "pending",
  ).length;
  return (
    <div className="stack">
      <div className="admin-stat-grid">
        <div className="admin-stat">
          <span className="muted">Aguardando análise</span>
          <strong>{pendingCount.toString().padStart(2, "0")}</strong>
          <span>solicitações pendentes</span>
        </div>
        <div className="admin-stat">
          <span className="muted">Na agenda</span>
          <strong>
            {requests
              .filter((row) => row.status === "approved")
              .length.toString()
              .padStart(2, "0")}
          </strong>
          <span>eventos aprovados</span>
        </div>
        <div className="admin-stat">
          <span className="muted">Solicitações enviadas</span>
          <strong>{requests.length.toString().padStart(2, "0")}</strong>
          <span>registros para acompanhar</span>
        </div>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ANÁLISE DE EVENTOS</p>
            <h2>Solicitações</h2>
          </div>
          <button
            className="button small"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
        <div className="toolbar">
          <label className="field search-field">
            <span>Buscar solicitações</span>
            <div className="input-icon">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Evento, ambiente ou curso"
              />
            </div>
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Todos os status</option>
              {Object.entries(STATUS)
                .filter(([key]) => key !== "draft")
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {status === "pending" && (
          <p className="muted">
            Fila por ordem de envio. Solicitações anteriores para o mesmo
            ambiente e horário têm prioridade de análise.
          </p>
        )}
        <ErrorMessage message={error} />
        {loading ? (
          <Loading />
        ) : !error && visible.length === 0 ? (
          <div className="empty-state">
            <ClipboardList size={30} />
            <h3>Nenhuma solicitação por aqui</h3>
            <p>
              {search || status
                ? "Ajuste os filtros para encontrar outros registros."
                : "As solicitações enviadas aparecerão nesta lista."}
            </p>
          </div>
        ) : (
          !error && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Data e horário</th>
                    <th>Enviada em / fila</th>
                    <th>Ambiente</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name || "Sem título"}</strong>
                        <small>{row.courseName || "Curso não informado"}</small>
                      </td>
                      <td>
                        {dateLabel(row.date)}
                        <small>{times(row)}</small>
                      </td>
                      <td>
                        {submittedLabel(row.submittedAt)}
                        {row.queueSequence && (
                          <small>Ordem de envio: {row.queueSequence}</small>
                        )}
                      </td>
                      <td>{row.roomName || "Não informado"}</td>
                      <td>
                        <span className={`badge ${row.status}`}>
                          {STATUS[row.status] || row.status}
                        </span>
                      </td>
                      <td>
                        <button
                          className="button small"
                          onClick={() => onOpenRequest(row, onRefresh)}
                          aria-label={`Analisar ${row.name || "solicitação"}`}
                        >
                          Abrir
                          <ArrowRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {!loading && !error && visible.length > 0 && (
          <p className="muted table-caption">
            {visible.length}{" "}
            {visible.length === 1
              ? "solicitação encontrada"
              : "solicitações encontradas"}
          </p>
        )}
      </section>
    </div>
  );
}

function Catalog({ api, metadata, onMetadata, notify }) {
  const [entity, setEntity] = useState("rooms");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const catalog = CATALOGS[entity];
  const rows = metadata[entity] || [];
  function openForm(row) {
    setEditing(row || null);
    setForm({
      name: row?.name || "",
      description: row?.description || "",
      costCenterId: row?.costCenterId || "",
      resourceIds: row?.resourceIds || [],
    });
    setError("");
  }
  function selectEntity(value) {
    setEntity(value);
    setForm(null);
    setEditing(null);
    setDeleting(null);
    setError("");
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
      };
      if (entity === "courses") body.costCenterId = form.costCenterId;
      if (entity === "rooms") body.resourceIds = form.resourceIds;
      await api(`/admin/catalog/${entity}${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body,
      });
      await onMetadata();
      setForm(null);
      setEditing(null);
      notify("Cadastro salvo com sucesso.", "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/catalog/${entity}/${deleting.id}`, {
        method: "DELETE",
      });
      await onMetadata();
      setDeleting(null);
      notify("Cadastro excluído.", "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ESTRUTURA DOS EVENTOS</p>
          <h2>Cadastros</h2>
          <p className="muted">
            Mantenha os espaços e as informações usados nas solicitações.
          </p>
        </div>
        <button className="button primary" onClick={() => openForm(null)}>
          <Plus size={18} />
          Adicionar {catalog.singular}
        </button>
      </div>
      <div
        className="tabs catalog-tabs"
        role="group"
        aria-label="Tipos de cadastro"
      >
        {Object.entries(CATALOGS).map(([key, item]) => (
          <button
            key={key}
            className={entity === key ? "active" : ""}
            onClick={() => selectEntity(key)}
            aria-pressed={entity === key}
          >
            {item.label}
            <span>{(metadata[key] || []).length}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <Building2 size={30} />
          <h3>Nenhum cadastro encontrado</h3>
          <p>Adicione o primeiro {catalog.singular} para começar.</p>
        </div>
      ) : (
        <div className="catalog-list">
          {rows.map((row) => (
            <article className="catalog-card" key={row.id}>
              <div>
                <h3>{row.name}</h3>
                {row.description && <p className="muted">{row.description}</p>}
                {entity === "courses" && (
                  <p className="muted">
                    Centro de custo:{" "}
                    {metadata.costCenters?.find((center) =>
                      sameId(center.id, row.costCenterId),
                    )?.name || "Não informado"}
                  </p>
                )}
                {entity === "rooms" && (
                  <p className="muted">
                    {row.resourceIds?.length
                      ? row.resourceIds
                          .map(
                            (id) =>
                              metadata.resources?.find((resource) =>
                                sameId(resource.id, id),
                              )?.name,
                          )
                          .filter(Boolean)
                          .join(" · ")
                      : "Sem recursos associados"}
                  </p>
                )}
              </div>
              <div className="form-actions">
                <button
                  className="button small"
                  onClick={() => openForm(row)}
                  aria-label={`Editar ${row.name}`}
                >
                  <Edit3 size={15} />
                  Editar
                </button>
                <button
                  className="button danger small"
                  onClick={() => {
                    setDeleting(row);
                    setError("");
                  }}
                  aria-label={`Excluir ${row.name}`}
                >
                  <Trash2 size={15} />
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {form && (
        <Modal
          title={`${editing ? "Editar" : "Adicionar"} ${catalog.singular}`}
          onClose={() => setForm(null)}
          busy={busy}
        >
          <form onSubmit={save} className="stack">
            <label className="field">
              <span>
                Nome <span aria-hidden="true">*</span>
              </span>
              <input
                required
                maxLength={160}
                autoComplete="off"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Descrição</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </label>
            {entity === "courses" && (
              <label className="field">
                <span>
                  Centro de custo <span aria-hidden="true">*</span>
                </span>
                <select
                  required
                  value={form.costCenterId}
                  onChange={(event) =>
                    setForm({ ...form, costCenterId: event.target.value })
                  }
                >
                  <option value="">Selecione um centro de custo</option>
                  {metadata.costCenters?.map((center) => (
                    <option value={center.id} key={center.id}>
                      {center.name}
                    </option>
                  ))}
                </select>
                {!metadata.costCenters?.length && (
                  <small className="muted">
                    Cadastre um centro de custo antes de adicionar um curso.
                  </small>
                )}
              </label>
            )}
            {entity === "rooms" && (
              <fieldset className="field">
                <legend>Recursos disponíveis no ambiente</legend>
                {metadata.resources?.length ? (
                  <div className="checkbox-grid">
                    {metadata.resources.map((resource) => (
                      <label className="checkbox-option" key={resource.id}>
                        <input
                          type="checkbox"
                          checked={form.resourceIds.some((id) =>
                            sameId(id, resource.id),
                          )}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              resourceIds: event.target.checked
                                ? [...form.resourceIds, resource.id]
                                : form.resourceIds.filter(
                                    (id) => !sameId(id, resource.id),
                                  ),
                            })
                          }
                        />
                        {resource.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    Cadastre recursos para associá-los aos ambientes.
                  </p>
                )}
              </fieldset>
            )}
            <ErrorMessage message={error} />
            <div className="form-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                Cancelar
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={
                  busy ||
                  (entity === "courses" && !metadata.costCenters?.length)
                }
              >
                <Check size={16} />
                {busy ? "Salvando…" : "Salvar cadastro"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Excluir cadastro"
          onClose={() => setDeleting(null)}
          busy={busy}
        >
          <p>
            Deseja excluir <strong>{deleting.name}</strong>?
          </p>
          <p className="muted">
            A exclusão será permitida apenas se não houver vínculos com eventos
            ou outros cadastros.
          </p>
          <ErrorMessage message={error} />
          <div className="form-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Voltar
            </button>
            <button className="button danger" disabled={busy} onClick={remove}>
              <Trash2 size={16} />
              {busy ? "Excluindo…" : "Excluir cadastro"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function UserManagement({ api, notify, user, onAccountChanged }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [confirmingAccessChange, setConfirmingAccessChange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError("");
    api("/admin/users")
      .then((data) => {
        if (current) setUsers(data.users);
      })
      .catch((err) => {
        if (current) setLoadError(err.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, refresh]);
  function openForm(row) {
    setEditing(row || null);
    setConfirmingAccessChange(false);
    setError("");
    setForm({
      name: row?.name || "",
      email: row?.email || "",
      companyName: row?.companyName || "",
      cnpj: row?.cnpj || "",
      password: "",
      role: row?.role || "requester",
      active: row ? Boolean(row.active) : true,
    });
  }
  const deactivating = Boolean(editing?.active) && form?.active === false;
  const roleRank = { visitor: 0, requester: 1, admin: 2 };
  const reducingAccess =
    Boolean(editing && form) && roleRank[form.role] < roleRank[editing.role];
  function save(event) {
    event.preventDefault();
    if (busy) return;
    if (deactivating || reducingAccess) {
      setError("");
      setConfirmingAccessChange(true);
      return;
    }
    persistUser();
  }
  async function persistUser() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        companyName: form.companyName.trim(),
        cnpj: form.cnpj.trim(),
      };
      if (!body.password) delete body.password;
      await api(`/admin/users${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body,
      });
      setForm(null);
      setConfirmingAccessChange(false);
      setRefresh((value) => value + 1);
      if (editing?.id === user.id) await onAccountChanged?.();
      notify(
        deactivating
          ? "Usuário desativado. O acesso à conta foi encerrado."
          : "Usuário salvo com sucesso.",
        "success",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const visible = users.filter(
    (row) =>
      !search ||
      `${row.name} ${row.email} ${row.companyName || ""} ${row.cnpj || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACESSO AO SISTEMA</p>
          <h2>Usuários</h2>
          <p className="muted">
            Gerencie contas, perfis e permissões de acesso.
          </p>
        </div>
        <button className="button primary" onClick={() => openForm(null)}>
          <Plus size={18} />
          Adicionar usuário
        </button>
      </div>
      <div className="toolbar">
        <label className="field search-field">
          <span>Buscar usuários</span>
          <div className="input-icon">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              placeholder="Nome, e-mail, empresa ou CNPJ"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </label>
        <button
          className="button small"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>
      <ErrorMessage message={loadError} />
      {loading ? (
        <Loading />
      ) : !loadError && visible.length === 0 ? (
        <div className="empty-state">
          <Users size={30} />
          <h3>Nenhum usuário encontrado</h3>
          <p>Tente buscar por outro nome ou e-mail.</p>
        </div>
      ) : (
        !loadError && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Perfil</th>
                  <th>Situação</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {row.name}
                        {sameId(row.id, user.id) && (
                          <span className="muted"> · você</span>
                        )}
                      </strong>
                      <small>{row.email}</small>
                      {row.companyName && <small>{row.companyName}</small>}
                      {row.cnpj && <small>CNPJ: {row.cnpj}</small>}
                    </td>
                    <td>{ROLES[row.role] || row.role}</td>
                    <td>
                      <span
                        className={`badge ${row.active ? "approved" : "cancelled"}`}
                      >
                        {row.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button small"
                        onClick={() => openForm(row)}
                        aria-label={`Editar ${row.name}`}
                      >
                        <Edit3 size={15} />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {form && (
        <Modal
          key={confirmingAccessChange ? "confirm-access" : "user-form"}
          title={
            confirmingAccessChange
              ? deactivating
                ? "Desativar usuário"
                : "Reduzir permissões do usuário"
              : editing
                ? "Editar usuário"
                : "Adicionar usuário"
          }
          onClose={() => setForm(null)}
          busy={busy}
        >
          {confirmingAccessChange ? (
            <div className="stack">
              <p>
                Confirme as alterações de acesso de <strong>{form.name}</strong>{" "}
                ({form.email}).
              </p>
              {deactivating && (
                <p>
                  A conta ficará inativa e as sessões abertas serão encerradas.
                  O usuário não conseguirá entrar até que a administração
                  reative o acesso.
                </p>
              )}
              {reducingAccess && (
                <p>
                  O perfil mudará de <strong>{ROLES[editing.role]}</strong> para{" "}
                  <strong>{ROLES[form.role]}</strong>. As permissões do perfil
                  anterior serão removidas e será necessário entrar novamente.
                </p>
              )}
              <p className="muted">
                As solicitações e o histórico serão mantidos.
              </p>
              <ErrorMessage message={error} />
              <div className="form-actions">
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingAccessChange(false);
                    setError("");
                  }}
                >
                  Voltar para edição
                </button>
                <button
                  className="button danger"
                  type="button"
                  disabled={busy}
                  onClick={persistUser}
                >
                  {busy
                    ? "Salvando…"
                    : deactivating
                      ? "Confirmar desativação"
                      : "Confirmar redução de acesso"}
                </button>
              </div>
            </div>
          ) : (
            <form className="stack" onSubmit={save}>
              <label className="field">
                <span>
                  Nome completo <span aria-hidden="true">*</span>
                </span>
                <input
                  required
                  autoComplete="name"
                  maxLength={160}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>
                  E-mail <span aria-hidden="true">*</span>
                </span>
                <input
                  required
                  type="email"
                  autoComplete="off"
                  maxLength={254}
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>{editing ? "Nova senha" : "Senha *"}</span>
                <input
                  required={!editing}
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                />
                <small className="muted">
                  {editing ? "Deixe em branco para manter a senha atual. " : ""}
                  Use pelo menos 12 caracteres.
                </small>
              </label>
              <label className="field">
                <span>
                  Perfil <span aria-hidden="true">*</span>
                </span>
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm({ ...form, role: event.target.value })
                  }
                >
                  {Object.entries(ROLES).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {form.role === "requester" && (
                <>
                  <label className="field">
                    <span>Nome da empresa</span>
                    <input
                      required={
                        !editing ||
                        editing.role !== "requester" ||
                        Boolean(editing.companyName || editing.cnpj)
                      }
                      autoComplete="organization"
                      maxLength={200}
                      value={form.companyName}
                      onChange={(event) =>
                        setForm({ ...form, companyName: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>CNPJ</span>
                    <input
                      required={
                        !editing ||
                        editing.role !== "requester" ||
                        Boolean(editing.companyName || editing.cnpj)
                      }
                      type="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={18}
                      value={form.cnpj}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          cnpj: event.target.value.toUpperCase(),
                        })
                      }
                    />
                    {editing && !editing.companyName && !editing.cnpj && (
                      <small className="muted">
                        Conta anterior ao cadastro de empresa. Para completar os
                        dados, informe a empresa e o CNPJ juntos.
                      </small>
                    )}
                  </label>
                </>
              )}
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) =>
                    setForm({ ...form, active: event.target.checked })
                  }
                />
                Conta ativa
              </label>
              <p className="muted">
                Contas inativas não conseguem entrar no sistema.
              </p>
              <ErrorMessage message={error} />
              <div className="form-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </button>
                <button
                  className={
                    deactivating || reducingAccess
                      ? "button danger"
                      : "button primary"
                  }
                  disabled={busy}
                >
                  <Check size={16} />
                  {busy
                    ? "Salvando…"
                    : deactivating
                      ? "Revisar desativação"
                      : reducingAccess
                        ? "Revisar redução de acesso"
                        : "Salvar usuário"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </section>
  );
}

function Reports({ api, metadata }) {
  const today = useMemo(todaySaoPaulo, []);
  const initial = useMemo(
    () => ({
      ...weekRange(today),
      courseId: "",
      themeId: "",
      status: "",
      period: "week",
    }),
    [today],
  );
  const [weekDay, setWeekDay] = useState(today);
  const [year, setYear] = useState(today.slice(0, 4));
  const [filters, setFilters] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const query = useMemo(
    () =>
      new URLSearchParams(
        Object.entries(applied).filter(
          ([key, value]) => key !== "period" && value,
        ),
      ).toString(),
    [applied],
  );
  const pptxQuery = useMemo(
    () =>
      new URLSearchParams(
        Object.entries(applied).filter(
          ([key, value]) => key !== "status" && value,
        ),
      ).toString(),
    [applied],
  );
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api(`/admin/reports?${query}`)
      .then((data) => {
        if (current) setEvents(data.events);
      })
      .catch((err) => {
        if (current) setError(err.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, query, refresh]);
  function choosePeriod(period) {
    const selectedYear =
      /^\d{4}$/.test(year) && Number(year) >= 1900 ? year : today.slice(0, 4);
    if (period === "year") setYear(selectedYear);
    const range =
      period === "week"
        ? weekRange(weekDay)
        : period === "year"
          ? { from: `${selectedYear}-01-01`, to: `${selectedYear}-12-31` }
          : { from: filters.from, to: filters.to };
    setFilters({ ...filters, ...range, period });
  }
  function submit(event) {
    event.preventDefault();
    if (!filters.from || !filters.to || filters.from > filters.to) {
      setError(
        "Informe um período válido, com a data final igual ou posterior à inicial.",
      );
      return;
    }
    setApplied({ ...filters });
    setRefresh((value) => value + 1);
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">DADOS PARA PLANEJAR</p>
          <h2>Relatórios de eventos</h2>
          <p className="muted">
            Selecione a semana, o ano ou um período personalizado.
          </p>
        </div>
        {!loading && !error && (
          <div className="view-controls">
            <a
              className="button"
              href={`${import.meta.env.BASE_URL}api/admin/reports.csv?${query}`}
              download
            >
              <ArrowDownToLine size={17} /> Excel / CSV
            </a>
            <a
              className="button primary"
              href={`${import.meta.env.BASE_URL}api/admin/agenda.pptx?${pptxQuery}`}
              download
            >
              <ArrowDownToLine size={17} /> PowerPoint · aprovados
            </a>
            <a
              className="button"
              href={`${import.meta.env.BASE_URL}api/admin/agenda.pdf?${pptxQuery}`}
              download
            >
              <ArrowDownToLine size={17} /> PDF · aprovados
            </a>
          </div>
        )}
      </div>
      <form className="form-grid report-filters" onSubmit={submit}>
        <label className="field">
          <span>Tipo de período</span>
          <select
            value={filters.period}
            onChange={(event) => choosePeriod(event.target.value)}
          >
            <option value="week">Semanal · segunda a domingo</option>
            <option value="year">Anual · ano completo</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>
        {filters.period === "week" && (
          <label className="field">
            <span>Escolha um dia da semana desejada</span>
            <input
              type="date"
              required
              value={weekDay}
              onChange={(event) => {
                setWeekDay(event.target.value);
                if (event.target.value)
                  setFilters({ ...filters, ...weekRange(event.target.value) });
              }}
            />
          </label>
        )}
        {filters.period === "year" && (
          <label className="field">
            <span>Ano do relatório</span>
            <input
              type="number"
              min="1900"
              max="9999"
              required
              value={year}
              onChange={(event) => {
                const next = event.target.value;
                setYear(next);
                if (/^\d{4}$/.test(next))
                  setFilters({
                    ...filters,
                    from: `${next}-01-01`,
                    to: `${next}-12-31`,
                  });
              }}
            />
          </label>
        )}
        <label className="field">
          <span>Data inicial</span>
          <input
            type="date"
            required
            value={filters.from}
            onChange={(event) =>
              setFilters({
                ...filters,
                from: event.target.value,
                period: "custom",
              })
            }
          />
        </label>
        <label className="field">
          <span>Data final</span>
          <input
            type="date"
            required
            min={filters.from || undefined}
            value={filters.to}
            onChange={(event) =>
              setFilters({
                ...filters,
                to: event.target.value,
                period: "custom",
              })
            }
          />
        </label>
        <label className="field">
          <span>Setor / curso / coordenação</span>
          <select
            value={filters.courseId}
            onChange={(event) =>
              setFilters({ ...filters, courseId: event.target.value })
            }
          >
            <option value="">Todos os setores e cursos</option>
            {metadata.courses?.map((row) => (
              <option value={row.id} key={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tema</span>
          <select
            value={filters.themeId}
            onChange={(event) =>
              setFilters({ ...filters, themeId: event.target.value })
            }
          >
            <option value="">Todos os temas</option>
            {metadata.themes?.map((row) => (
              <option value={row.id} key={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status da tabela e do CSV</span>
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value })
            }
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS)
              .filter(([key]) => key !== "draft")
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <div className="form-actions">
          <button
            className="button"
            type="button"
            onClick={() => {
              setWeekDay(today);
              setYear(today.slice(0, 4));
              setFilters(initial);
              setApplied(initial);
              setRefresh((value) => value + 1);
            }}
          >
            Semana atual
          </button>
          <button className="button primary" type="submit" disabled={loading}>
            <Search size={16} /> Aplicar filtros
          </button>
        </div>
      </form>
      <p className="muted table-caption">
        Período aplicado: {dateLabel(applied.from)} a {dateLabel(applied.to)}.
        PowerPoint e PDF incluem somente eventos aprovados nos filtros de
        período, setor e tema. O CSV acompanha o status selecionado.
      </p>
      <ErrorMessage message={error} />
      {loading ? (
        <Loading children="Preparando relatório…" />
      ) : !error && !events.length ? (
        <div className="empty-state">
          <BarChart3 size={30} />
          <h3>Nenhum evento encontrado</h3>
          <p>Experimente outro período ou combinação de filtros.</p>
        </div>
      ) : (
        !error && (
          <>
            <p className="muted table-caption">
              {events.length}{" "}
              {events.length === 1
                ? "evento encontrado"
                : "eventos encontrados"}
            </p>
            <div className="table-wrap">
              <table className="data-table report-data-table">
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Data</th>
                    <th>Início</th>
                    <th>Fim</th>
                    <th>Tema</th>
                    <th>Setor / curso</th>
                    <th>Centro de custo</th>
                    <th>Ambiente</th>
                    <th>Realização</th>
                    <th>Público</th>
                    <th>Solicitante</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name || "Sem título"}</strong>
                      </td>
                      <td>{dateLabel(row.date)}</td>
                      <td>{row.startTime || "—"}</td>
                      <td>{row.endTime || "—"}</td>
                      <td>{row.themeName || "—"}</td>
                      <td>{row.courseName || "—"}</td>
                      <td>{row.costCenterName || "—"}</td>
                      <td>{row.roomName || "—"}</td>
                      <td>{row.organizer || "—"}</td>
                      <td>
                        {[
                          row.audience,
                          row.audienceCourseName,
                          /^\d+$/.test(String(row.audienceSemester || ""))
                            ? `${row.audienceSemester}º semestre`
                            : row.audienceSemester,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td>{row.requesterName || row.requester || "—"}</td>
                      <td>
                        <span className={`badge ${row.status}`}>
                          {STATUS[row.status] || row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </section>
  );
}

export default function Admin({
  api,
  metadata,
  onMetadata,
  onOpenRequest,
  notify,
  user,
  onAccountChanged,
}) {
  const [tab, setTab] = useState("requests");
  const [refreshKey, setRefreshKey] = useState(0);
  const tabs = [
    { id: "requests", label: "Solicitações", Icon: ClipboardList },
    { id: "catalog", label: "Cadastros", Icon: Layers3 },
    { id: "users", label: "Usuários", Icon: Users },
    { id: "reports", label: "Relatórios", Icon: BarChart3 },
  ];
  return (
    <div className="admin-shell stack">
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">ORGANIZAR PARA CONECTAR</span>
          <h1>
            Gestão de eventos<span className="green-text">.</span>
          </h1>
          <p>Da primeira solicitação ao próximo encontro.</p>
        </div>
      </div>
      {(!metadata.themes.length ||
        !metadata.rooms.length ||
        !metadata.courses.length) && (
        <div className="notice">
          <strong>Prepare a agenda para receber solicitações.</strong>
          <p>
            Cadastre centros de custo, recursos, cursos, ambientes e temas para
            começar.
          </p>
          <button className="text-button" onClick={() => setTab("catalog")}>
            Organizar os cadastros <ArrowRight size={15} />
          </button>
        </div>
      )}
      <nav className="admin-nav tabs" aria-label="Administração">
        {tabs.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      {tab === "requests" && (
        <Requests
          api={api}
          metadata={metadata}
          onOpenRequest={onOpenRequest}
          refreshKey={refreshKey}
          onRefresh={() => setRefreshKey((value) => value + 1)}
        />
      )}
      {tab === "catalog" && (
        <Catalog
          api={api}
          metadata={metadata}
          onMetadata={onMetadata}
          notify={notify}
        />
      )}
      {tab === "users" && (
        <UserManagement
          api={api}
          notify={notify}
          user={user}
          onAccountChanged={onAccountChanged}
        />
      )}
      {tab === "reports" && <Reports api={api} metadata={metadata} />}
    </div>
  );
}
