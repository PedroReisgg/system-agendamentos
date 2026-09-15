create or replace function public.available_slots(p_professional_id uuid, p_service_id uuid, p_date date)
returns table (start_time time, end_time time)
language sql security definer set search_path = public as $$
  with config as (
    select s.duration_minutes, t.booking_buffer_minutes
    from services s join professionals p on p.id = p_professional_id join tenants t on t.id = p.tenant_id
    where s.id = p_service_id and s.tenant_id = p.tenant_id and s.active and p.active
  ), slots as (
    select slot::time as start_time, (slot + (select duration_minutes from config) * interval '1 minute')::time as end_time
    from working_hours wh, lateral generate_series(p_date + wh.start_time, p_date + wh.end_time - (select duration_minutes from config) * interval '1 minute', interval '30 minutes') slot
    where wh.professional_id = p_professional_id and wh.day_of_week = extract(dow from p_date)
  )
  select s.start_time, s.end_time from slots s
  where p_date >= (now() at time zone 'America/Sao_Paulo')::date
    and (p_date > (now() at time zone 'America/Sao_Paulo')::date or s.start_time >= date_trunc('hour', now() at time zone 'America/Sao_Paulo' + (select booking_buffer_minutes from config) * interval '1 minute')::time)
    and not exists (select 1 from appointments a where a.professional_id = p_professional_id and a.appointment_date = p_date and a.status in ('pending','confirmed','rescheduled') and a.start_time < s.end_time and a.end_time > s.start_time)
  order by s.start_time;
$$;

grant execute on function public.available_slots(uuid, uuid, date) to anon, authenticated;

create or replace function public.reserve_appointment(p_professional_id uuid, p_service_id uuid, p_date date, p_start_time time)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_tenant uuid; v_duration smallint; v_end time; v_id uuid := gen_random_uuid();
begin
  select id, tenant_id into v_client, v_tenant from users where auth_user_id = auth.uid() and role = 'client';
  if v_client is null then raise exception 'Cliente não autenticado'; end if;
  select s.duration_minutes into v_duration from services s join professional_services ps on ps.service_id=s.id where s.id=p_service_id and ps.professional_id=p_professional_id and s.tenant_id=v_tenant;
  if v_duration is null then raise exception 'Serviço inválido'; end if;
  v_end := p_start_time + v_duration * interval '1 minute';
  if not exists (select 1 from available_slots(p_professional_id,p_service_id,p_date) where start_time=p_start_time) then raise exception 'Horário indisponível'; end if;
  insert into appointments(id,tenant_id,client_id,professional_id,service_id,appointment_date,start_time,end_time,status) values(v_id,v_tenant,v_client,p_professional_id,p_service_id,p_date,p_start_time,v_end,'pending');
  return v_id;
end;
$$;

grant execute on function public.reserve_appointment(uuid, uuid, date, time) to authenticated;
