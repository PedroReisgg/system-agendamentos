-- Dados iniciais de demonstração. Execute uma única vez no SQL Editor.
-- Troque os nomes, preços e horários depois pelo painel administrativo.
do $$
declare
  v_tenant uuid;
  v_corte uuid;
  v_barba uuid;
  v_spa uuid;
  v_ana_user uuid;
  v_lucas_user uuid;
  v_ana uuid;
  v_lucas uuid;
begin
  select id into v_tenant from public.tenants where slug = 'casa-ambar';
  if v_tenant is null then raise exception 'Tenant casa-ambar não encontrado'; end if;

  insert into public.services (tenant_id, name, description, price, duration_minutes)
  values (v_tenant, 'Corte & finalização', 'Corte personalizado com lavagem e finalização.', 85, 60)
  on conflict do nothing returning id into v_corte;
  select id into v_corte from public.services where tenant_id=v_tenant and name='Corte & finalização';

  insert into public.services (tenant_id, name, description, price, duration_minutes)
  values (v_tenant, 'Barba ritual', 'Toalha quente, desenho e acabamento.', 55, 45)
  on conflict do nothing returning id into v_barba;
  select id into v_barba from public.services where tenant_id=v_tenant and name='Barba ritual';

  insert into public.services (tenant_id, name, description, price, duration_minutes)
  values (v_tenant, 'Spa capilar', 'Tratamento de hidratação e massagem.', 120, 75)
  on conflict do nothing returning id into v_spa;
  select id into v_spa from public.services where tenant_id=v_tenant and name='Spa capilar';

  insert into public.users (tenant_id,name,email,phone,role,staff_access_level,job_title)
  values (v_tenant,'Ana Martins','ana@casaambar.local','5511999990001','professional','viewer','Cabeleireira')
  on conflict (email) do nothing returning id into v_ana_user;
  select id into v_ana_user from public.users where email='ana@casaambar.local';

  insert into public.users (tenant_id,name,email,phone,role,staff_access_level,job_title)
  values (v_tenant,'Lucas Costa','lucas@casaambar.local','5511999990002','professional','viewer','Barbeiro')
  on conflict (email) do nothing returning id into v_lucas_user;
  select id into v_lucas_user from public.users where email='lucas@casaambar.local';

  insert into public.professionals (tenant_id,user_id,bio)
  values (v_tenant,v_ana_user,'Especialista em cortes, cor e tratamentos.')
  on conflict (user_id) do nothing returning id into v_ana;
  select id into v_ana from public.professionals where user_id=v_ana_user;

  insert into public.professionals (tenant_id,user_id,bio)
  values (v_tenant,v_lucas_user,'Barbearia contemporânea e acabamento preciso.')
  on conflict (user_id) do nothing returning id into v_lucas;
  select id into v_lucas from public.professionals where user_id=v_lucas_user;

  insert into public.professional_services (professional_id,service_id)
  values (v_ana,v_corte),(v_ana,v_spa),(v_lucas,v_corte),(v_lucas,v_barba)
  on conflict do nothing;

  insert into public.working_hours (professional_id,day_of_week,start_time,end_time)
  select v_ana, d, '09:00', '18:00' from generate_series(1,6) d on conflict do nothing;
  insert into public.working_hours (professional_id,day_of_week,start_time,end_time)
  select v_lucas, d, '10:00', '19:00' from generate_series(1,6) d on conflict do nothing;
end $$;
