import React, { useEffect, useMemo, useState } from 'react';
import './owner-dashboard.css';
import StaffRegistration from './StaffRegistration';

const isoDate = (date = new Date()) => date.toISOString().slice(0, 10);
const readTime = (value) => String(value || '').slice(0, 5);
const formatDate = (value) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${value}T12:00:00`));
const headers = () => ({ 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('agenda_token')}` });

export default function OwnerDashboard({ api, supabase, services, tenant, user, onHome, onLogout, onAccount }) {
  const [professionals, setProfessionals] = useState([]);
  const [clients, setClients] = useState([]);
  const [professionalId, setProfessionalId] = useState('');
  const [date, setDate] = useState(isoDate());
  const [appointments, setAppointments] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [staffRegistration, setStaffRegistration] = useState(false);
  const isStaff = ['admin', 'professional', 'cashier'].includes(user?.role);
  const isManager = ['admin', 'cashier'].includes(user?.role) || user?.staffAccessLevel === 'manager';

  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, { ...options, headers: { ...headers(), ...options.headers } });
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) throw Error(body?.error || 'Não foi possível concluir esta ação.');
    return body;
  }
  async function loadProfessionals() {
    try {
      const data = await request('/staff/professionals');
      setProfessionals(data);
      setProfessionalId((current) => current || data[0]?.id || '');
    } catch (exception) { setError(exception.message); }
  }
  async function loadClients() {
    try { setClients(await request('/staff/clients')); }
    catch (exception) { setError(exception.message); }
  }
  async function loadAppointments({ quiet = false } = {}) {
    if (!professionalId) return;
    try {
      const data = await request(`/staff/appointments?professionalId=${encodeURIComponent(professionalId)}&date=${date}`);
      setAppointments((current) => {
        if (quiet && data.some((item) => !current.some((old) => old.id === item.id))) setNotice('Novo agendamento recebido. A agenda foi atualizada.');
        return data;
      });
    } catch (exception) { if (!quiet) setError(exception.message); }
  }
  useEffect(() => { if (isStaff) { loadProfessionals(); loadClients(); } }, [isStaff]);
  useEffect(() => { loadAppointments(); }, [professionalId, date]);
  useEffect(() => {
    if (!professionalId) return undefined;
    const id = window.setInterval(() => loadAppointments({ quiet: true }), 20000);
    return () => window.clearInterval(id);
  }, [professionalId, date]);

  const selectedProfessional = professionals.find((item) => item.id === professionalId);
  const stats = useMemo(() => ({
    total: appointments.length,
    confirmed: appointments.filter((item) => item.status === 'confirmed').length,
    pending: appointments.filter((item) => item.status === 'pending').length
  }), [appointments]);
  const openNew = () => setEditor({ clientId: clients[0]?.id || '', professionalId, serviceId: services[0]?.id || '', appointmentDate: date, startTime: '09:00', status: 'confirmed' });
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const isEdit = Boolean(editor.id);
      await request(isEdit ? `/staff/appointments/${editor.id}` : '/staff/appointments', { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify(editor) });
      setEditor(null); setNotice(isEdit ? 'Agendamento atualizado.' : 'Horário adicionado à agenda.');
      await loadAppointments();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  };
  const remove = async (appointment) => {
    if (!window.confirm(`Excluir o agendamento de ${appointment.client_name}?`)) return;
    try { await request(`/staff/appointments/${appointment.id}`, { method: 'DELETE' }); setNotice('Agendamento excluído.'); await loadAppointments(); }
    catch (exception) { setError(exception.message); }
  };
  const changeStatus = async (appointment, status) => {
    try { await request(`/staff/appointments/${appointment.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); setNotice('Status atualizado.'); await loadAppointments(); }
    catch (exception) { setError(exception.message); }
  };

  if (!isStaff) return <main className="owner-denied"><p className="owner-kicker">ÁREA RESTRITA</p><h1>Entre com uma conta da equipe.</h1><button onClick={onAccount}>Entrar na minha conta</button></main>;
  return <div className="owner-shell"><header className="owner-header"><button className="owner-brand" onClick={onHome}>{tenant?.config_json?.logoText || tenant?.name || 'CASA ÂMBAR'}</button><div className="owner-header-meta"><span className="owner-live"><i />Agenda sincronizada</span><button onClick={onLogout}>Sair</button></div></header>
    <main className="owner-main">
      <section className="owner-intro"><div><p className="owner-kicker">PAINEL DO ESPAÇO</p><h1>Agenda feita para quem cuida do atendimento.</h1><p>{isManager ? 'Selecione um profissional para acompanhar e administrar os horários.' : 'Sua conta possui acesso somente para consultar a lista de horários e clientes.'}</p></div>{isManager && <div className="owner-actions"><button className="owner-secondary" onClick={()=>setStaffRegistration(true)}>Equipe</button><button className="owner-primary" onClick={openNew} disabled={!professionalId}>+ Adicionar horário</button></div>}</section>
      <p className="owner-feedback" role="status" aria-live="polite">{notice || error}</p>
      <section className="professional-selector" aria-label="Seleção de profissional"><div><span>01</span><div><strong>Escolha o profissional</strong><small>A agenda será carregada por dia.</small></div></div><div className="professional-pills">{professionals.map((professional) => <button key={professional.id} className={professional.id === professionalId ? 'active' : ''} onClick={() => setProfessionalId(professional.id)}><i>{professional.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</i><span>{professional.name}</span></button>)}</div></section>
      <section className="owner-workspace"><aside className="owner-sidebar"><p className="owner-kicker">VISÃO DO DIA</p><label>Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><div className="owner-stat"><strong>{stats.total}</strong><span>horários no dia</span></div><div className="owner-stat muted"><strong>{stats.confirmed}</strong><span>confirmados</span></div><div className="owner-stat warm"><strong>{stats.pending}</strong><span>aguardando confirmação</span></div><button className="owner-secondary" onClick={() => loadAppointments()}>Atualizar agenda</button></aside>
        <section className="agenda-panel"><header><div><p className="owner-kicker">AGENDA DE {selectedProfessional?.name?.toUpperCase() || '...'} </p><h2>{formatDate(date)}</h2></div><button className="owner-icon-button" aria-label="Adicionar agendamento" onClick={openNew}>+</button></header><div className="agenda-list">{appointments.length ? appointments.map((appointment) => <article className="appointment-row" key={appointment.id}><time>{readTime(appointment.start_time)}<small>{readTime(appointment.end_time)}</small></time><div className="appointment-client"><strong>{appointment.client_name}</strong><span>{appointment.service_name}</span><small>{appointment.client_phone}</small></div><span className={`status ${appointment.status}`}>{appointment.status === 'pending' ? 'Pendente' : appointment.status === 'confirmed' ? 'Confirmado' : appointment.status === 'rescheduled' ? 'Remarcado' : 'Cancelado'}</span><div className="appointment-actions"><a href={appointment.whatsapp_url} target="_blank" rel="noreferrer" title="Abrir WhatsApp">WhatsApp</a>{appointment.status === 'pending' && <button onClick={() => changeStatus(appointment, 'confirmed')}>Confirmar</button>}<button onClick={() => setEditor({ ...appointment, clientId: appointment.client_id, professionalId: appointment.professional_id, serviceId: appointment.service_id, appointmentDate: String(appointment.appointment_date).slice(0, 10), startTime: readTime(appointment.start_time) })}>Editar</button><button className="delete" onClick={() => remove(appointment)}>Excluir</button></div></article>) : <div className="agenda-empty"><span>○</span><h3>Nenhum horário nesta data.</h3><p>Adicione um atendimento manual ou escolha outro dia.</p><button onClick={openNew}>Adicionar horário</button></div>}</div></section></section>
    </main>
    {editor && <div className="owner-modal-backdrop" role="presentation"><form className="owner-editor" onSubmit={save}><button className="editor-close" type="button" onClick={() => setEditor(null)} aria-label="Fechar">×</button><p className="owner-kicker">{editor.id ? 'EDITAR AGENDAMENTO' : 'NOVO AGENDAMENTO'}</p><h2>{editor.id ? 'Ajuste os detalhes do horário.' : 'Adicione um horário à agenda.'}</h2><label>Cliente<select required value={editor.clientId} onChange={(event) => setEditor({ ...editor, clientId: event.target.value })}>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.phone}</option>)}</select></label><label>Profissional<select required value={editor.professionalId} onChange={(event) => setEditor({ ...editor, professionalId: event.target.value })}>{professionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}</option>)}</select></label><label>Serviço<select required value={editor.serviceId} onChange={(event) => setEditor({ ...editor, serviceId: event.target.value })}>{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.duration_minutes} min</option>)}</select></label><div className="editor-grid"><label>Data<input required type="date" value={editor.appointmentDate} onChange={(event) => setEditor({ ...editor, appointmentDate: event.target.value })} /></label><label>Horário<input required type="time" value={editor.startTime} onChange={(event) => setEditor({ ...editor, startTime: event.target.value })} /></label></div><label>Status<select value={editor.status} onChange={(event) => setEditor({ ...editor, status: event.target.value })}><option value="pending">Pendente</option><option value="confirmed">Confirmado</option><option value="cancelled">Cancelado</option><option value="rescheduled">Remarcado</option></select></label><button className="owner-primary" disabled={busy || !clients.length || !services.length}>{busy ? 'Salvando...' : 'Salvar agendamento'}</button>{!clients.length && <p className="editor-warning">Cadastre ao menos um cliente antes de criar horários manuais.</p>}</form></div>}{staffRegistration&&<StaffRegistration supabase={supabase} onClose={()=>setStaffRegistration(false)} onSaved={()=>setNotice('Funcionário cadastrado com sucesso.')}/>}</div>;
}
