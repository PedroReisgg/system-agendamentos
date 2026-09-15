create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_tenant uuid;
begin
  select id into target_tenant from public.tenants where slug = coalesce(new.raw_user_meta_data->>'tenant_slug', 'casa-ambar');
  insert into public.users (tenant_id, name, email, phone, gender, role, favorite_services, auth_user_id)
  values (target_tenant, coalesce(new.raw_user_meta_data->>'name', 'Cliente'), new.email, coalesce(new.raw_user_meta_data->>'phone', ''), coalesce(new.raw_user_meta_data->>'gender', 'OUTRO'), 'client', coalesce(new.raw_user_meta_data->'favorite_services', '[]'::jsonb), new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create policy "public tenant read" on public.tenants for select using (true);
create policy "public service read" on public.services for select using (active = true);
create policy "public professional read" on public.professionals for select using (active = true);
create policy "public professional services read" on public.professional_services for select using (true);
create policy "public working hours read" on public.working_hours for select using (true);
create policy "user reads own profile" on public.users for select using (auth.uid() = auth_user_id);
create policy "user reads own appointments" on public.appointments for select using (client_id = (select id from public.users where auth_user_id = auth.uid()));
