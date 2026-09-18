-- Execute uma vez no SQL Editor do Supabase.
-- Define o horário do estabelecimento e permite administrar a jornada dos profissionais.

alter table public.empresas
  add column if not exists horario_abertura time not null default '09:00',
  add column if not exists horario_fechamento time not null default '18:00';

alter table public.empresas drop constraint if exists empresas_horario_funcionamento_valido;
alter table public.empresas add constraint empresas_horario_funcionamento_valido
  check (horario_fechamento > horario_abertura);

alter table public.horarios_trabalho enable row level security;
drop policy if exists "publico le horarios de profissionais" on public.horarios_trabalho;
drop policy if exists "gestor gerencia horarios de profissionais" on public.horarios_trabalho;
create policy "publico le horarios de profissionais"
on public.horarios_trabalho for select using (true);
create policy "gestor gerencia horarios de profissionais"
on public.horarios_trabalho for all
using (exists(select 1 from public.profissionais p where p.id=profissional_id and public.eh_gestor_empresa(p.empresa_id)))
with check (exists(select 1 from public.profissionais p where p.id=profissional_id and public.eh_gestor_empresa(p.empresa_id)));

create or replace function public.horarios_disponiveis(
  p_profissional_id uuid,
  p_servico_id uuid,
  p_data date
)
returns table(hora_inicio time,hora_fim time)
language sql security definer set search_path = public as $$
  with configuracao as (
    select s.duracao_minutos,e.antecedencia_minima_minutos,e.horario_abertura,e.horario_fechamento
    from public.servicos s
    join public.profissionais p on p.id=p_profissional_id
    join public.empresas e on e.id=p.empresa_id
    where s.id=p_servico_id and s.empresa_id=p.empresa_id and s.ativo and p.ativo
  ), relogio as (
    select now() at time zone 'America/Sao_Paulo' as agora
  ), limite as (
    select date_trunc('hour', agora + configuracao.antecedencia_minima_minutos * interval '1 minute')
      + ceil(extract(minute from agora + configuracao.antecedencia_minima_minutos * interval '1 minute') / 30.0) * interval '30 minutes' as proximo_horario
    from relogio cross join configuracao
  ), horarios as (
    select intervalo::time hora_inicio,
      (intervalo+(select duracao_minutos from configuracao)*interval '1 minute')::time hora_fim
    from public.horarios_trabalho ht,
      lateral generate_series(
        greatest(p_data+ht.hora_inicio,p_data+(select horario_abertura from configuracao)),
        least(p_data+ht.hora_fim,p_data+(select horario_fechamento from configuracao))-(select duracao_minutos from configuracao)*interval '1 minute',
        interval '30 minutes'
      ) intervalo
    where ht.profissional_id=p_profissional_id and ht.dia_semana=extract(dow from p_data)
  )
  select h.hora_inicio,h.hora_fim
  from horarios h cross join relogio cross join limite
  where p_data >= relogio.agora::date
    and (p_data+h.hora_inicio) >= limite.proximo_horario
    and not exists(
      select 1 from public.agendamentos a
      where a.profissional_id=p_profissional_id
        and a.data_agendamento=p_data
        and a.situacao in ('pendente','confirmado','remarcado')
        and a.hora_inicio<h.hora_fim and a.hora_fim>h.hora_inicio
    )
  order by h.hora_inicio;
$$;

grant execute on function public.horarios_disponiveis(uuid,uuid,date) to anon,authenticated;
