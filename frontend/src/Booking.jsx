import React, { useEffect, useMemo, useState } from 'react';

const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));

export default function Booking({ supabase, tenant, services, user, onHome, onAccount, onLogout }) {
  const [step, setStep] = useState(1);
  const [date, setDate] = useState(dateKey(new Date()));
  const [service, setService] = useState(null);
  const [professionals, setProfessionals] = useState([]);
  const [professional, setProfessional] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const days = useMemo(() => Array.from({ length: 14 }, (_, index) => {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + index);
    return day;
  }), []);

  useEffect(() => {
    if (!service || !supabase) return;
    let active = true;
    setLoading(true);
    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
    supabase
      .from('professionals')
      .select('id, bio, users!professionals_user_id_fkey(name), professional_services!inner(service_id), working_hours(day_of_week)')
      .eq('active', true)
      .eq('professional_services.service_id', service.id)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setNotice(error.message);
        else setProfessionals((data || [])
          .filter((item) => item.working_hours?.some((hours) => hours.day_of_week === dayOfWeek))
          .map((item) => ({ id: item.id, name: item.users?.name || 'Profissional', bio: item.bio || 'Especialista Casa Âmbar' })));
        setLoading(false);
      });
    setProfessional(null);
    setSlot(null);
    return () => { active = false; };
  }, [date, service, supabase]);

  useEffect(() => {
    if (!professional || !service || !supabase) return;
    let active = true;
    setLoading(true);
    supabase.rpc('available_slots', {
      p_professional_id: professional.id,
      p_service_id: service.id,
      p_date: date
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) setNotice(error.message);
      else setSlots((data || []).map((item) => String(item.start_time).slice(0, 5)));
      setLoading(false);
    });
    setSlot(null);
    return () => { active = false; };
  }, [date, professional, service, supabase]);

  async function confirm() {
    if (!user) { onAccount(); return; }
    setLoading(true);
    setNotice('');
    const { error } = await supabase.rpc('reserve_appointment', {
      p_professional_id: professional.id,
      p_service_id: service.id,
      p_date: date,
      p_start_time: slot
    });
    setLoading(false);
    if (error) setNotice(error.message);
    else setNotice('Solicitação enviada. O estabelecimento confirmará seu horário.');
  }

  const config = tenant.config_json || {};
  return <div className="booking-shell">
    <header className="booking-header">
      <button className="brand" onClick={onHome}>{config.logoText || tenant.name}</button>
      <div className="booking-header-actions">{user ? <button className="account" onClick={onLogout}>Sair</button> : <button className="account" onClick={onAccount}>Minha conta</button>}</div>
    </header>
    <main className="booking-main">
      <p className="eyebrow">RESERVA ONLINE</p><h1>Seu próximo ritual começa aqui.</h1>
      <ol className="steps">{['Data', 'Serviço', 'Profissional', 'Horário'].map((label, index) => <li key={label} className={step === index + 1 ? 'current' : step > index + 1 ? 'done' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
      {step === 1 && <section className="booking-card"><h2>Quando você quer vir?</h2><div className="date-strip">{days.map((day) => { const value = dateKey(day); return <button key={value} className={date === value ? 'selected' : ''} onClick={() => setDate(value)}><small>{new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(day)}</small><strong>{day.getDate()}</strong><small>{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(day)}</small></button>; })}</div><button className="primary" onClick={() => setStep(2)}>Continuar</button></section>}
      {step === 2 && <section className="booking-card"><button className="back" onClick={() => setStep(1)}>Voltar</button><h2>Qual serviço?</h2><div className="service-list">{services.map((item) => <button key={item.id} className={service?.id === item.id ? 'selected' : ''} onClick={() => setService(item)}><span><strong>{item.name}</strong><small>{item.description}</small></span><b>{money(item.price)} · {item.duration_minutes} min</b></button>)}</div><button className="primary" disabled={!service} onClick={() => setStep(3)}>Escolher profissional</button></section>}
      {step === 3 && <section className="booking-card"><button className="back" onClick={() => setStep(2)}>Voltar</button><h2>Escolha o profissional</h2>{loading ? <p className="empty">Carregando profissionais...</p> : <div className="professional-grid">{professionals.map((item) => <button key={item.id} className={professional?.id === item.id ? 'selected' : ''} onClick={() => setProfessional(item)}><span className="initials">{item.name.slice(0, 2)}</span><strong>{item.name}</strong><small>{item.bio}</small></button>)}</div>}{!loading && !professionals.length && <p className="empty">Não há profissionais disponíveis nesta data.</p>}<button className="primary" disabled={!professional} onClick={() => setStep(4)}>Ver horários</button></section>}
      {step === 4 && <section className="booking-card"><button className="back" onClick={() => setStep(3)}>Voltar</button><h2>Horários disponíveis</h2>{loading ? <p className="empty">Calculando horários...</p> : <div className="slot-grid">{slots.map((value) => <button key={value} className={slot === value ? 'selected' : ''} onClick={() => setSlot(value)}>{value}</button>)}</div>}{!loading && !slots.length && <p className="empty">Sem horários disponíveis para este dia.</p>}<button className="primary" disabled={!slot || loading} onClick={confirm}>Confirmar horário</button></section>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </main>
  </div>;
}
