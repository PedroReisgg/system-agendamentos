-- Execute uma vez no SQL Editor do Supabase, após painel-equipe.ptbr.sql.
-- Horários só aparecem depois da antecedência mínima e sempre em blocos de 30 min.

alter table public.empresas enable row level security;
drop policy if exists "equipe altera configuracao da empresa" on public.empresas;
create policy "equipe altera configuracao da empresa"
on public.empresas for update
using (public.eh_equipe_empresa(id))
with check (public.eh_equipe_empresa(id));

create or replace function public.horarios_disponiveis(
  p_profissional_id uuid,
  p_servico_id uuid,
  p_data date
)
returns table(hora_inicio time,hora_fim time)
language sql security definer set search_path = public as $$
  with configuracao as (
    select s.duracao_minutos,e.antecedencia_minima_minutos
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
        p_data+ht.hora_inicio,
        p_data+ht.hora_fim-(select duracao_minutos from configuracao)*interval '1 minute',
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
