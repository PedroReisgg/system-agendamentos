import { createClient } from '@supabase/supabase-js';

const resposta=(status,body)=>Response.json(body,{status});
const numeros=v=>String(v||'').replace(/\D/g,'');
const papeis=['profissional','caixa','administrador'];

export default async request=>{
 try{
  if(!['POST','PATCH','DELETE'].includes(request.method))return resposta(405,{error:'Método não permitido.'});
  const url=process.env.SUPABASE_URL;
  const chaveServico=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!chaveServico)return resposta(500,{error:'A função de equipe não está configurada no Netlify. Adicione SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis do site.'});
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return resposta(401,{error:'Sua sessão expirou. Entre novamente.'});
  const admin=createClient(url,chaveServico,{auth:{autoRefreshToken:false,persistSession:false}});
  const{data:auth,error:erroAuth}=await admin.auth.getUser(token);
  if(erroAuth||!auth.user)return resposta(401,{error:'Sessão inválida. Entre novamente.'});
  const{data:autor,error:erroAutor}=await admin.from('usuarios').select('id,empresa_id,papel,nivel_acesso').eq('usuario_auth_id',auth.user.id).maybeSingle();
  if(erroAutor||!autor)return resposta(403,{error:'Não foi possível identificar a sua empresa.'});
  if(!(['administrador','caixa'].includes(autor.papel)||autor.nivel_acesso==='gestor'))return resposta(403,{error:'Sua conta não possui permissão para administrar a equipe.'});
  let dados;try{dados=await request.json()}catch{return resposta(400,{error:'Dados do formulário inválidos.'})}
  const nome=String(dados.nome||'').trim();
  const email=String(dados.email||'').trim().toLowerCase();
  const telefone=numeros(dados.telefone);
  const cpf=numeros(dados.cpf);
  const cargo=String(dados.cargo||'Profissional').trim();
  const papel=papeis.includes(dados.papel)?dados.papel:'profissional';
  const nivel_acesso=dados.nivel_acesso==='gestor'?'gestor':'visualizador';
  const dadosValidos=nome&&/^\S+@\S+\.\S+$/.test(email)&&/^\d{10,11}$/.test(telefone)&&/^\d{11}$/.test(cpf);

  if(request.method==='POST'){
   const senha=String(dados.senha||'');
   if(!dadosValidos||senha.length<3)return resposta(422,{error:'Preencha nome, CPF com 11 dígitos, telefone brasileiro, e-mail e senha de ao menos 3 caracteres.'});
   const{data:empresa,error:erroEmpresa}=await admin.from('empresas').select('id,slug').eq('id',autor.empresa_id).single();
   if(erroEmpresa||!empresa)return resposta(422,{error:'Empresa não encontrada para este usuário.'});
   const{data:criado,error:erroCriacao}=await admin.auth.admin.createUser({email,password:senha,email_confirm:true,user_metadata:{nome,telefone,cpf,slug_empresa:empresa.slug}});
   if(erroCriacao||!criado.user)return resposta(422,{error:erroCriacao?.message||'Não foi possível criar o acesso do funcionário.'});
   const perfil={empresa_id:empresa.id,nome,email,telefone,cpf,genero:'OUTRO',papel,nivel_acesso,cargo,usuario_auth_id:criado.user.id,servicos_favoritos:[]};
   let{data:usuario,error:erroPerfil}=await admin.from('usuarios').select('id').eq('usuario_auth_id',criado.user.id).maybeSingle();
   if(usuario){({data:usuario,error:erroPerfil}=await admin.from('usuarios').update(perfil).eq('id',usuario.id).select('id').single())}
   else({data:usuario,error:erroPerfil}=await admin.from('usuarios').insert(perfil).select('id').single());
   if(erroPerfil||!usuario){await admin.auth.admin.deleteUser(criado.user.id);return resposta(422,{error:`A conta foi criada, mas o perfil não pôde ser salvo: ${erroPerfil?.message||'erro desconhecido'}`})}
   if(papel==='profissional'){
    const{data:profissional,error:erroProfissional}=await admin.from('profissionais').select('id').eq('usuario_id',usuario.id).maybeSingle();
    if(!profissional){const{error}=await admin.from('profissionais').insert({empresa_id:empresa.id,usuario_id:usuario.id,biografia:`${cargo} da equipe.`,ativo:true});if(error)return resposta(422,{error:`A conta foi criada, mas o perfil profissional falhou: ${error.message}`})}
   }
   return resposta(201,{message:'Funcionário cadastrado e liberado para login.'});
  }

  const id=String(dados.id||'');
  if(!id)return resposta(422,{error:'Funcionário não informado.'});
  const{data:alvo,error:erroAlvo}=await admin.from('usuarios').select('id,usuario_auth_id,empresa_id').eq('id',id).maybeSingle();
  if(erroAlvo||!alvo||alvo.empresa_id!==autor.empresa_id)return resposta(404,{error:'Funcionário não encontrado nesta empresa.'});
  if(alvo.id===autor.id)return resposta(422,{error:'Use Meu perfil para alterar sua própria conta.'});
  if(request.method==='DELETE'){
   const{error}=await admin.auth.admin.deleteUser(alvo.usuario_auth_id);
   return error?resposta(422,{error:error.message}):resposta(200,{message:'Funcionário excluído com sucesso.'});
  }
  if(!dadosValidos)return resposta(422,{error:'Preencha nome, CPF, telefone e e-mail válidos.'});
  const atualizacao={email,user_metadata:{nome,telefone,cpf}};
  if(String(dados.senha||'').length>=3)atualizacao.password=String(dados.senha);
  const{error:erroAtualizarAuth}=await admin.auth.admin.updateUserById(alvo.usuario_auth_id,atualizacao);
  if(erroAtualizarAuth)return resposta(422,{error:erroAtualizarAuth.message});
  const{error:erroAtualizar}=await admin.from('usuarios').update({nome,email,telefone,cpf,cargo,papel,nivel_acesso}).eq('id',id);
  if(erroAtualizar)return resposta(422,{error:erroAtualizar.message});
  const{data:profissional}=await admin.from('profissionais').select('id').eq('usuario_id',id).maybeSingle();
  if(papel==='profissional'&&!profissional)await admin.from('profissionais').insert({empresa_id:autor.empresa_id,usuario_id:id,biografia:`${cargo} da equipe.`,ativo:true});
  if(papel!=='profissional'&&profissional)await admin.from('profissionais').delete().eq('id',profissional.id);
  return resposta(200,{message:'Funcionário atualizado com sucesso.'});
 }catch(error){return resposta(500,{error:`Erro interno ao cadastrar funcionário: ${error?.message||'erro desconhecido'}`})}
};
