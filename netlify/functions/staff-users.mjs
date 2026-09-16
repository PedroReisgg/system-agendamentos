import { createClient } from '@supabase/supabase-js';

const resposta=(statusCode,corpo)=>({statusCode,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(corpo)});
const apenasNumeros=valor=>String(valor||'').replace(/\D/g,'');
const papeisPermitidos=['profissional','caixa','administrador'];

export default async request=>{
  if(!['POST','PATCH','DELETE'].includes(request.method))return resposta(405,{error:'Método não permitido.'});
  const url=process.env.SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!serviceKey)return resposta(500,{error:'Função administrativa não configurada no Netlify.'});
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return resposta(401,{error:'Sessão não encontrada.'});
  const admin=createClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
  const{data:authData,error:authError}=await admin.auth.getUser(token);
  if(authError||!authData.user)return resposta(401,{error:'Sessão inválida.'});
  const{data:autor}=await admin.from('usuarios').select('id,empresa_id,papel,nivel_acesso').eq('usuario_auth_id',authData.user.id).single();
  const podeGerir=autor&&(['administrador','caixa'].includes(autor.papel)||autor.nivel_acesso==='gestor');
  if(!podeGerir)return resposta(403,{error:'Sua conta não possui permissão para administrar a equipe.'});
  let dados;try{dados=await request.json()}catch{return resposta(400,{error:'Dados inválidos.'})}
  const nome=String(dados.nome||'').trim(),email=String(dados.email||'').trim().toLowerCase(),telefone=apenasNumeros(dados.telefone),cpf=apenasNumeros(dados.cpf),cargo=String(dados.cargo||'Profissional').trim();
  const papel=papeisPermitidos.includes(dados.papel)?dados.papel:'profissional';
  const nivelAcesso=dados.nivel_acesso==='gestor'?'gestor':'visualizador';

  if(request.method==='POST'){
    const senha=String(dados.senha||'');
    if(!nome||!/^\S+@\S+\.\S+$/.test(email)||senha.length<3||!/^\d{10,11}$/.test(telefone)||!/^\d{11}$/.test(cpf))return resposta(422,{error:'Preencha nome, CPF, e-mail, senha de ao menos 3 caracteres e telefone brasileiro.'});
    const{data:empresa}=await admin.from('empresas').select('slug').eq('id',autor.empresa_id).single();
    const{data:criado,error:erroCriacao}=await admin.auth.admin.createUser({email,password:senha,email_confirm:true,user_metadata:{nome,telefone,cpf,slug_empresa:empresa?.slug||'casa-ambar'}});
    if(erroCriacao||!criado.user)return resposta(422,{error:erroCriacao?.message||'Não foi possível criar a conta.'});
    const{data:perfil,error:erroPerfil}=await admin.from('usuarios').update({nome,email,telefone,cpf,cargo,papel,nivel_acesso:nivelAcesso}).eq('usuario_auth_id',criado.user.id).select('id').single();
    if(erroPerfil||!perfil){await admin.auth.admin.deleteUser(criado.user.id);return resposta(500,{error:'A conta foi criada, mas o perfil não pôde ser configurado.'})}
    if(papel==='profissional'){const{error}=await admin.from('profissionais').insert({empresa_id:autor.empresa_id,usuario_id:perfil.id,biografia:`${cargo} da equipe.`,ativo:true});if(error)return resposta(500,{error:'Conta criada, mas não foi possível criar o perfil profissional.'})}
    return resposta(201,{message:'Funcionário cadastrado com sucesso.'});
  }

  const perfilId=String(dados.id||'');
  if(!perfilId)return resposta(422,{error:'Funcionário não informado.'});
  const{data:alvo}=await admin.from('usuarios').select('id,usuario_auth_id,empresa_id').eq('id',perfilId).single();
  if(!alvo||alvo.empresa_id!==autor.empresa_id)return resposta(404,{error:'Funcionário não encontrado nesta empresa.'});
  if(alvo.id===autor.id)return resposta(422,{error:'Use seu perfil para alterar a própria conta.'});

  if(request.method==='DELETE'){
    const{error}=await admin.auth.admin.deleteUser(alvo.usuario_auth_id);
    if(error)return resposta(422,{error:error.message});
    return resposta(200,{message:'Funcionário excluído com sucesso.'});
  }

  if(!nome||!/^\S+@\S+\.\S+$/.test(email)||!/^\d{10,11}$/.test(telefone)||!/^\d{11}$/.test(cpf))return resposta(422,{error:'Preencha nome, CPF, e-mail e telefone brasileiro válidos.'});
  const atualizacaoAuth={email,user_metadata:{nome,telefone,cpf}};
  if(String(dados.senha||'').length>=3)atualizacaoAuth.password=String(dados.senha);
  const{error:erroAuth}=await admin.auth.admin.updateUserById(alvo.usuario_auth_id,atualizacaoAuth);
  if(erroAuth)return resposta(422,{error:erroAuth.message});
  const{error:erroAtualizacao}=await admin.from('usuarios').update({nome,email,telefone,cpf,cargo,papel,nivel_acesso:nivelAcesso}).eq('id',perfilId);
  if(erroAtualizacao)return resposta(422,{error:erroAtualizacao.message});
  const{data:profissional}=await admin.from('profissionais').select('id').eq('usuario_id',perfilId).maybeSingle();
  if(papel==='profissional'&&!profissional)await admin.from('profissionais').insert({empresa_id:autor.empresa_id,usuario_id:perfilId,biografia:`${cargo} da equipe.`,ativo:true});
  if(papel!=='profissional'&&profissional)await admin.from('profissionais').delete().eq('id',profissional.id);
  return resposta(200,{message:'Funcionário atualizado com sucesso.'});
};
