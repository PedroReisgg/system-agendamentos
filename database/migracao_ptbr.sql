-- MIGRAÇÃO ÚNICA: esquema anterior em inglês -> PT-BR.
-- Execute no SQL Editor do Supabase antes de publicar o frontend atualizado.
begin;

alter type public.user_role rename to papel_usuario;
alter type public.staff_access_level rename to nivel_acesso;
alter type public.appointment_status rename to situacao_agendamento;
alter type public.papel_usuario rename value 'client' to 'cliente';
alter type public.papel_usuario rename value 'professional' to 'profissional';
alter type public.papel_usuario rename value 'cashier' to 'caixa';
alter type public.papel_usuario rename value 'admin' to 'administrador';
alter type public.nivel_acesso rename value 'viewer' to 'visualizador';
alter type public.nivel_acesso rename value 'manager' to 'gestor';
alter type public.situacao_agendamento rename value 'pending' to 'pendente';
alter type public.situacao_agendamento rename value 'confirmed' to 'confirmado';
alter type public.situacao_agendamento rename value 'cancelled' to 'cancelado';
alter type public.situacao_agendamento rename value 'rescheduled' to 'remarcado';

alter table public.tenants rename to empresas;
alter table public.users rename to usuarios;
alter table public.services rename to servicos;
alter table public.professionals rename to profissionais;
alter table public.professional_services rename to profissionais_servicos;
alter table public.working_hours rename to horarios_trabalho;
alter table public.appointments rename to agendamentos;

alter table public.empresas rename column name to nome;
alter table public.empresas rename column config_json to configuracao_json;
alter table public.empresas rename column booking_buffer_minutes to antecedencia_minima_minutos;
alter table public.empresas rename column created_at to criado_em;

alter table public.usuarios rename column tenant_id to empresa_id;
alter table public.usuarios rename column name to nome;
alter table public.usuarios rename column phone to telefone;
alter table public.usuarios rename column gender to genero;
alter table public.usuarios rename column role to papel;
alter table public.usuarios rename column staff_access_level to nivel_acesso;
alter table public.usuarios rename column job_title to cargo;
alter table public.usuarios rename column favorite_services to servicos_favoritos;
alter table public.usuarios rename column auth_user_id to usuario_auth_id;
alter table public.usuarios rename column created_at to criado_em;
alter table public.usuarios rename column updated_at to atualizado_em;
-- O gatilho legado escrevia em updated_at. Remova-o antes de atualizar dados
-- durante esta própria migração, pois a coluna já foi renomeada.
drop trigger if exists users_set_updated_at on public.usuarios;
alter table public.usuarios add column if not exists cpf varchar(11) unique check (cpf is null or cpf ~ '^[0-9]{11}$');
alter table public.usuarios add column if not exists data_nascimento date;
alter table public.usuarios add column if not exists cep varchar(8) check (cep is null or cep ~ '^[0-9]{8}$');
alter table public.usuarios add column if not exists logradouro text;
alter table public.usuarios add column if not exists numero text;
alter table public.usuarios add column if not exists complemento text;
alter table public.usuarios add column if not exists bairro text;
alter table public.usuarios add column if not exists cidade text;
alter table public.usuarios add column if not exists estado char(2);
alter table public.usuarios add column if not exists foto_url text;
alter table public.usuarios drop constraint if exists users_phone_check;
-- Dados legados usavam E.164 (+55...). Remove caracteres e o DDI brasileiro.
update public.usuarios set telefone = regexp_replace(telefone, '\D', '', 'g');
update public.usuarios set telefone = substring(telefone from 3) where telefone ~ '^55[0-9]{10,11}$';
alter table public.usuarios add constraint usuarios_telefone_brasileiro check (telefone ~ '^[0-9]{10,11}$');

alter table public.servicos rename column tenant_id to empresa_id;
alter table public.servicos rename column name to nome;
alter table public.servicos rename column description to descricao;
alter table public.servicos rename column price to preco;
alter table public.servicos rename column duration_minutes to duracao_minutos;
alter table public.servicos rename column active to ativo;
alter table public.servicos rename column created_at to criado_em;

alter table public.profissionais rename column tenant_id to empresa_id;
alter table public.profissionais rename column user_id to usuario_id;
alter table public.profissionais rename column bio to biografia;
alter table public.profissionais rename column active to ativo;
alter table public.profissionais rename column created_at to criado_em;

alter table public.profissionais_servicos rename column professional_id to profissional_id;
alter table public.profissionais_servicos rename column service_id to servico_id;
alter table public.horarios_trabalho rename column professional_id to profissional_id;
alter table public.horarios_trabalho rename column day_of_week to dia_semana;
alter table public.horarios_trabalho rename column start_time to hora_inicio;
alter table public.horarios_trabalho rename column end_time to hora_fim;

alter table public.agendamentos rename column tenant_id to empresa_id;
alter table public.agendamentos rename column client_id to cliente_id;
alter table public.agendamentos rename column professional_id to profissional_id;
alter table public.agendamentos rename column service_id to servico_id;
alter table public.agendamentos rename column appointment_date to data_agendamento;
alter table public.agendamentos rename column start_time to hora_inicio;
alter table public.agendamentos rename column end_time to hora_fim;
alter table public.agendamentos rename column status to situacao;
alter table public.agendamentos rename column created_at to criado_em;
alter table public.agendamentos rename column updated_at to atualizado_em;
drop trigger if exists appointments_set_updated_at on public.agendamentos;
alter table public.agendamentos add column if not exists observacao text;

drop policy if exists "user reads own profile" on public.usuarios;
drop policy if exists "public reads professional profiles" on public.usuarios;
create policy "usuario le proprio perfil" on public.usuarios for select using (auth.uid() = usuario_auth_id);
create policy "usuario atualiza proprio perfil" on public.usuarios for update using (auth.uid() = usuario_auth_id) with check (auth.uid() = usuario_auth_id);
create policy "publico le perfis profissionais" on public.usuarios for select using (papel = 'profissional');

drop policy if exists "user reads own appointments" on public.agendamentos;
create policy "cliente le proprios agendamentos" on public.agendamentos for select using (cliente_id = (select id from public.usuarios where usuario_auth_id = auth.uid()));

create or replace function public.atualizar_atualizado_em()
returns trigger language plpgsql as $$ begin new.atualizado_em = now(); return new; end; $$;
create trigger usuarios_atualizar_atualizado_em before update on public.usuarios for each row execute function public.atualizar_atualizado_em();
create trigger agendamentos_atualizar_atualizado_em before update on public.agendamentos for each row execute function public.atualizar_atualizado_em();

create or replace function public.criar_perfil_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare empresa_destino uuid;
begin
  select id into empresa_destino from public.empresas where slug = coalesce(new.raw_user_meta_data->>'slug_empresa', 'casa-ambar');
  insert into public.usuarios (empresa_id,nome,email,telefone,genero,papel,servicos_favoritos,usuario_auth_id)
  values (empresa_destino,coalesce(new.raw_user_meta_data->>'nome','Cliente'),new.email,regexp_replace(coalesce(new.raw_user_meta_data->>'telefone',''), '\D','','g'),'OUTRO','cliente','[]'::jsonb,new.id);
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger ao_criar_usuario_auth after insert on auth.users for each row execute function public.criar_perfil_usuario();

insert into storage.buckets (id,name,public) values ('avatares','avatares',true) on conflict (id) do nothing;
create policy "usuario envia proprio avatar" on storage.objects for insert to authenticated with check (bucket_id='avatares' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "publico le avatares" on storage.objects for select using (bucket_id='avatares');
create policy "usuario altera proprio avatar" on storage.objects for update to authenticated using (bucket_id='avatares' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "usuario exclui proprio avatar" on storage.objects for delete to authenticated using (bucket_id='avatares' and (storage.foldername(name))[1]=auth.uid()::text);

commit;
