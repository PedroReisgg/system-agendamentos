-- Correção do buffer para horários do dia atual.
-- Execute este arquivo UMA vez no SQL Editor do Supabase.
create or replace function public.available_slots(p_professional_id uuid, p_service_id uuid, p_date date)
returns table (start_time time, end_time time)
language sql security definer set search_path = public as $$
  with config as (
    select s.duration_minutes, t.booking_buffer_minutes
    from services s
    join professionals p on p.id = p_professional_id
    join tenants t on t.id = p.tenant_id
    where s.id = p_service_id and s.tenant_id = p.tenant_id and s.active and p.active
  ), clock as (
    select now() at time zone 'America/Sao_Paulo' as local_now
  ), slots as (
    select slot as starts_at, slot::time as start_time,
      (slot + (select duration_minutes from config) * interval '1 minute')::time as end_time
    from working_hours wh,
      lateral generate_series(
        p_date + wh.start_time,
        p_date + wh.end_time - (select duration_minutes from config) * interval '1 minute',
        interval '30 minutes'
      ) slot
    where wh.professional_id = p_professional_id
      and wh.day_of_week = extract(dow from p_date)
  )
  select s.start_time, s.end_time
  from slots s cross join clock c cross join config
  where p_date >= c.local_now::date
    and (
      p_date > c.local_now::date
      or s.starts_at >= date_trunc('hour', c.local_now)
        + ceil((extract(minute from c.local_now) + config.booking_buffer_minutes)::numeric / 30) * interval '30 minutes'
    )
    and not exists (
      select 1 from appointments a
      where a.professional_id = p_professional_id
        and a.appointment_date = p_date
        and a.status in ('pending', 'confirmed', 'rescheduled')
        and a.start_time < s.end_time and a.end_time > s.start_time
    )
  order by s.start_time;
$$;
